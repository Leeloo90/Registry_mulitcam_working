import { useState, useCallback } from 'react';
import { MediaFile } from '../types';

export const useForensicSurveyor = (accessToken: string | null) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // CONFIGURATION: Must match your GCP Environment
  const BUCKET_NAME = "story-graph-proxies";
  const PROJECT_ID = "media-sync-registry";
  const LOCATION = "europe-west1"; 
  
  // Cloud Run Metadata Extractor Service URL
  const METADATA_SERVICE_URL = "https://metadata-extractor-286149224994.europe-west1.run.app";

  /**
   * Helper: Formats transcription results from Video Intelligence API
   */
  const formatTranscriptionResults = (annotationResults: any) => {
    const transcriptions = annotationResults?.[0]?.speechTranscriptions;
    if (!transcriptions || transcriptions.length === 0) return "No speech detected.";
    
    return transcriptions.map((transcription: any) => {
      const alt = transcription.alternatives?.[0];
      const startTime = alt?.words?.[0]?.startTime || "0s";
      return `[${startTime}] ${alt?.transcript || ""}`;
    }).join('\n\n');
  };

  /**
   * Mirroring Stage: Drive -> GCS
   * Required for the Cloud Run Extractor and Gemini to access raw file bytes.
   */
  const syncToGCS = async (file: MediaFile) => {
    const encodedName = encodeURIComponent(file.filename);
    
    // Check existence to avoid redundant uploads
    const checkRes = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodedName}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (checkRes.ok) return;

    console.log(`%c[Surveyor] Mirroring to GCS: ${file.filename}`, "color: #6366f1;");

    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.drive_id}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const blob = await driveRes.blob();
    
    const uploadRes = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET_NAME}/o?uploadType=media&name=${encodedName}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': file.mime_type },
        body: blob
      }
    );

    if (!uploadRes.ok) throw new Error("Mirroring to GCS failed. Check Bucket CORS settings.");
  };

  /**
   * PHASE 0: TECH PASS
   * Calls the Cloud Run MediaInfo wrapper for SMPTE timecode and frame-accurate metadata.
   */
  const runTechPass = async (file: MediaFile) => {
    try {
      const response = await fetch(METADATA_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.filename }) 
      });

      if (!response.ok) throw new Error("Metadata Service Failed");

      const metadata = await response.json();

      console.log('[Surveyor] Tech Metadata Ingested:', metadata);

      // Cloud service returns data wrapped in tech_metadata object
      const techData = metadata.tech_metadata || metadata;

      return {
        tech_metadata: {
          start_tc: techData.start_tc || "00:00:00:00",
          codec_id: techData.codec_id || 'Unknown',
          width: techData.width || 0,
          height: techData.height || 0,
          frame_rate_fraction: techData.frame_rate_fraction || '25.000',
          total_frames: techData.total_frames || '0',
          // Optional audio specs if returned by function
          sample_rate: techData.sample_rate,
          channels: techData.channels,
          bit_depth: techData.bit_depth,
          duration_ms: techData.duration_ms || 0
        },
        analysis_content: `SMPTE TC: ${techData.start_tc} | FPS: ${techData.frame_rate_fraction} | Frames: ${techData.total_frames}`,
        operation_id: 'completed',
        last_forensic_stage: 'tech' as const
      };
    } catch (err: any) {
      console.error("[Surveyor] Tech Pass Error:", err);
      return { analysis_content: `Tech Spec Error: ${err.message}`, operation_id: 'error' };
    }
  };

  /**
   * PHASE 1: DISCOVERY
   * Uses Gemini 2.0 Flash to triage clips (Interview vs B-Roll).
   */
  const runGeminiDiscovery = async (file: MediaFile, gcsUri: string) => {
    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash-001:generateContent`;
    
    // Normalize mimetype for Gemini (especially for Drive .wav files)
    const mimeType = file.media_category === 'audio' ? "audio/wav" : file.mime_type;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
          role: "user", 
          parts: [
            { fileData: { mimeType: mimeType, fileUri: gcsUri } }, 
            { text: `Analyze the audio and visuals of this clip. Is this an 'interview' or 'b-roll'? Respond ONLY with one of those two words.` }
          ] 
        }]
      })
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Gemini Discovery Failed");
    
    const rawResult = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase() || "";
    const isInterview = rawResult.includes('interview');
    
    return {
      clip_type: (isInterview ? 'interview' : 'b-roll') as 'interview' | 'b-roll',
      analysis_content: `Gemini Triage: ${isInterview ? 'Interview (Spine Candidate)' : 'B-Roll (Satellite Candidate)'}`,
      operation_id: 'light_complete',
      last_forensic_stage: 'light' as const
    };
  };

  /**
   * PHASE 2: HEAVY PASS
   * Triggers Video Intelligence API for long-running transcription or label detection.
   */
  const runHeavyPass = async (file: MediaFile, gcsUri: string, mode: 'b_roll_desc' | 'transcribe') => {
    const features = mode === 'transcribe' ? ['SPEECH_TRANSCRIPTION'] : ['LABEL_DETECTION', 'SHOT_CHANGE_DETECTION'];
    const videoContext = mode === 'transcribe' 
      ? { speechTranscriptionConfig: { languageCode: 'en-US', enableAutomaticPunctuation: true } }
      : { labelDetectionConfig: { labelDetectionMode: "SHOT_MODE" } };

    const res = await fetch(`https://videointelligence.googleapis.com/v1/videos:annotate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputUri: gcsUri, features, videoContext })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Cloud Analysis Error');
    
    return {
        operation_id: data.name, // Operation name for polling
        analysis_content: mode === 'transcribe' ? "Transcription in progress..." : "Deep visual analysis in progress...",
        last_forensic_stage: 'heavy' as const
    };
  };

  /**
   * Main Entry Point
   */
  const analyzeFile = useCallback(async (file: MediaFile, phase?: string): Promise<Partial<MediaFile>> => {
    if (!accessToken) throw new Error("Unauthorized: Access token missing.");
    setIsAnalyzing(true);
    
    try {
      await syncToGCS(file);
      const rawUri = `gs://${BUCKET_NAME}/${file.filename}`;

      switch (phase) {
        case 'tech_specs':
          return await runTechPass(file);
        case 'shot_type':
          return await runGeminiDiscovery(file, rawUri);
        case 'b_roll_desc':
          return await runHeavyPass(file, rawUri, 'b_roll_desc');
        case 'transcribe':
          return await runHeavyPass(file, rawUri, 'transcribe');
        default:
          return await runGeminiDiscovery(file, rawUri);
      }
    } catch (err: any) {
      console.error("[Surveyor] Pipeline Error:", err);
      return { analysis_content: `Error: ${err.message}`, operation_id: 'error' };
    } finally {
      setIsAnalyzing(false);
    }
  }, [accessToken]);

  /**
   * Polling Logic for long-running Video Intelligence tasks
   */
  const getAnalysisResult = useCallback(async (operationId: string) => {
    if (!accessToken || ['light_complete', 'error', 'completed'].includes(operationId)) return null;

    const res = await fetch(`https://videointelligence.googleapis.com/v1/${operationId}`, { 
      headers: { Authorization: `Bearer ${accessToken}` } 
    });
    const data = await res.json();
    
    if (!data.done) return { done: false };

    const results = data.response.annotationResults;
    if (results?.[0]?.speechTranscriptions) {
        return { done: true, content: formatTranscriptionResults(results) };
    }
    const labels = results?.[0]?.segmentLabelAnnotations?.map((l: any) => l.entity.description).join(", ");
    return { done: true, content: `Visual Labels: ${labels || 'None'}` };
  }, [accessToken]);

  return { analyzeFile, getAnalysisResult, isAnalyzing };
};