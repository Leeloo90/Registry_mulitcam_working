import { useState, useCallback } from 'react';
import { MediaFile } from '../types';

export const useForensicSurveyor = (accessToken: string | null) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // CONFIGURATION
  const BUCKET_NAME = "story-graph-proxies";
  const PROJECT_ID = "media-sync-registry";
  const LOCATION = "europe-west1"; 
  
  // Cloud Run Service URLs
  const METADATA_SERVICE_URL = "https://metadata-extractor-286149224994.europe-west1.run.app";
  const TRIAGE_SERVICE_URL = "https://categorization-triage-286149224994.us-central1.run.app";

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
   */
  const syncToGCS = async (file: MediaFile) => {
    const encodedName = encodeURIComponent(file.filename);
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

    if (!uploadRes.ok) throw new Error("Mirroring to GCS failed.");
  };

  /**
   * PHASE 0: TECH PASS
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
      const techData = metadata.tech_metadata || metadata;

      return {
        tech_metadata: {
          start_tc: techData.start_tc || "00:00:00:00",
          codec_id: techData.codec_id || 'Unknown',
          width: techData.width || 0,
          height: techData.height || 0,
          frame_rate_fraction: techData.frame_rate_fraction || '25.000',
          total_frames: techData.total_frames || '0',
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
      return { analysis_content: `Tech Spec Error: ${err.message}`, operation_id: 'error' };
    }
  };

  /**
   * PHASE 1: SNIPPET-BASED TRIAGE
   * Replaces runGeminiDiscovery. Uses the middle-fragment optimization.
   */
  const runSnippetTriage = async (file: MediaFile, retryWithLongerSnippet = false) => {
    try {
      // Use 15s for initial triage, 30s if confidence was low previously
      const windowSize = retryWithLongerSnippet ? 30 : 15;
      
      console.log(`[Surveyor] Snippet Triage (${windowSize}s): ${file.filename}`);

      const response = await fetch(TRIAGE_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.filename,
          duration_ms: file.tech_metadata?.duration_ms || 0,
          duration_limit: windowSize
        })
      });

      if (!response.ok) throw new Error("Triage Service Failed");

      const triage = await response.json();

      // Fallback logic: If confidence is low, run one more pass with a longer snippet
      if (triage.confidence < 0.8 && !retryWithLongerSnippet) {
        console.warn(`[Surveyor] Low confidence (${triage.confidence}), retrying with 30s snippet...`);
        return await runSnippetTriage(file, true);
      }

      const isInterview = triage.category === 'interview';

      return {
        clip_type: (isInterview ? 'interview' : 'b-roll') as 'interview' | 'b-roll',
        analysis_content: `Snippet Triage (${windowSize}s): ${isInterview ? 'Interview' : 'B-Roll'} (Conf: ${Math.round(triage.confidence * 100)}%)`,
        operation_id: 'light_complete',
        last_forensic_stage: 'light' as const
      };
    } catch (err: any) {
      console.error("[Surveyor] Triage Error:", err);
      return { analysis_content: `Triage Error: ${err.message}`, operation_id: 'error' };
    }
  };

  /**
   * PHASE 2: HEAVY PASS
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
        operation_id: data.name,
        analysis_content: mode === 'transcribe' ? "Transcription in progress..." : "Deep visual analysis in progress...",
        last_forensic_stage: 'heavy' as const
    };
  };

  /**
   * Main Entry Point
   */
  const analyzeFile = useCallback(async (file: MediaFile, phase?: string): Promise<Partial<MediaFile>> => {
    if (!accessToken) throw new Error("Unauthorized");
    setIsAnalyzing(true);
    
    try {
      await syncToGCS(file);
      const rawUri = `gs://${BUCKET_NAME}/${file.filename}`;

      switch (phase) {
        case 'tech_specs':
          return await runTechPass(file);
        case 'shot_type':
          return await runSnippetTriage(file); // Switched to optimized triage
        case 'b_roll_desc':
          return await runHeavyPass(file, rawUri, 'b_roll_desc');
        case 'transcribe':
          return await runHeavyPass(file, rawUri, 'transcribe');
        default:
          return await runSnippetTriage(file);
      }
    } catch (err: any) {
      console.error("[Surveyor] Pipeline Error:", err);
      return { analysis_content: `Error: ${err.message}`, operation_id: 'error' };
    } finally {
      setIsAnalyzing(false);
    }
  }, [accessToken]);

  /**
   * Polling Logic
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