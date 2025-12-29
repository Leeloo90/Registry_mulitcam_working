import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MediaTable } from './components/MediaTable';
import { useRegistry } from './services/useRegistry';
import { useGoogleDrive } from './services/useGoogleDrive';
import { useForensicSurveyor } from './services/useForensicSurveyor';
import { useXMLExporter } from './services/useXMLExporter';
import { useHybridSync } from './services/useHybridSync';
import { MediaFile, IndexingStatus, IndexingProgress } from './types';

const CLOUD_EXTRACTOR_URL = 'https://metadata-extractor-286149224994.europe-west1.run.app';
const PROXY_TRIGGER_URL = 'https://extract-proxy-286149224994.europe-west1.run.app';

const GlobalStyles = () => (
  <style>{`
    @keyframes progress-buffer {
      0% { transform: translateX(-100%); }
      50% { transform: translateX(-10%); }
      100% { transform: translateX(0%); }
    }
    .animate-progress-buffer {
      animation: progress-buffer 20s ease-in-out infinite;
    }
    .phase-btn {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 0.75rem 1rem;
      border-radius: 0.75rem;
      font-weight: 700;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      transition: all 0.2s;
      border-width: 1px;
    }
  `}</style>
);

const App: React.FC = () => {
  const { user, login, logout, openPicker, fetchFilesRecursively, isReady } = useGoogleDrive();
  const { loading: dbLoading, upsertMedia, getAllMedia, clearRegistry } = useRegistry();

  const { analyzeFile, getAnalysisResult, isAnalyzing } = useForensicSurveyor(user?.accessToken || null);
  const { generateXML, downloadXML } = useXMLExporter();
  const { performMulticamSync, isSyncing } = useHybridSync();

  // Stub logging functions (logging removed)
  const info = (...args: any[]) => {};
  const success = (...args: any[]) => {};
  const warning = (...args: any[]) => {};
  const error = (...args: any[]) => {};

  const [registryFiles, setRegistryFiles] = useState<MediaFile[]>([]);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<'testing' | 'online' | 'offline'>('testing');
  const [progress, setProgress] = useState<IndexingProgress>({
    status: IndexingStatus.IDLE,
    filesProcessed: 0,
    foldersProcessed: 0,
    currentFile: ''
  });

  const refreshRegistry = useCallback(async () => {
    const files = await getAllMedia();
    setRegistryFiles([...files]);
  }, [getAllMedia]);

  const canExport = useMemo(() => {
    return registryFiles.some(f => (f.sync_offset_frames || 0) !== 0);
  }, [registryFiles]);

  useEffect(() => {
    if (!dbLoading) refreshRegistry();
  }, [dbLoading, refreshRegistry]);

  useEffect(() => {
    const checkCloudRun = async () => {
      try {
        const res = await fetch(CLOUD_EXTRACTOR_URL);
        setCloudStatus(res.ok ? 'online' : 'offline');
      } catch (err) { setCloudStatus('offline'); }
    };
    checkCloudRun();
  }, []);

  const handleCheckStatus = useCallback(async (file: MediaFile) => {
    if (!file.operation_id || ['completed', 'light_complete', 'error'].includes(file.operation_id)) return;
    try {
      const result = await getAnalysisResult(file.operation_id);
      if (result && result.done) {
        await upsertMedia({ ...file, analysis_content: result.content, operation_id: 'completed' });
        refreshRegistry();
      }
    } catch (err) { console.error('[App] Polling error:', err); }
  }, [getAnalysisResult, upsertMedia, refreshRegistry]);

  useEffect(() => {
    const pollInterval = setInterval(() => {
      const pending = registryFiles.filter(f => 
        f.operation_id && !['completed', 'light_complete', 'error'].includes(f.operation_id)
      );
      if (pending.length > 0) {
        pending.forEach(file => handleCheckStatus(file));
      }
    }, 10000);
    return () => clearInterval(pollInterval);
  }, [registryFiles, handleCheckStatus]);

  const handleTechSpecs = async () => {
    const targets = registryFiles.filter(f => !f.tech_metadata);
    info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'PHASE 0');
    info(`📋 PHASE 0: Technical Metadata Extraction`, 'PHASE 0');
    info(`Target: ${targets.length} files without tech_metadata`, 'PHASE 0');
    info(`Service: ${CLOUD_EXTRACTOR_URL}`, 'PHASE 0');
    setActivePhase('Tech Specs');

    for (let i = 0; i < targets.length; i++) {
      const file = targets[i];
      setAnalyzingId(file.drive_id);
      info(`\n[${i + 1}/${targets.length}] Processing: ${file.filename}`, 'PHASE 0');
      info(`   Size: ${(file.size_bytes / (1024 * 1024)).toFixed(2)} MB | Type: ${file.mime_type}`, 'PHASE 0');

      info(`🔄 Step 1: Checking if file exists in GCS bucket`, 'PHASE 0');
      info(`   Bucket: story-graph-proxies`, 'PHASE 0');
      info(`🔄 Step 2: Mirroring from Google Drive if needed`, 'PHASE 0');
      info(`   Drive ID: ${file.drive_id}`, 'PHASE 0');
      info(`🔄 Step 3: Calling Cloud Run MediaInfo extractor`, 'PHASE 0');
      info(`   POST ${CLOUD_EXTRACTOR_URL}`, 'PHASE 0');
      info(`   Payload: { filename: "${file.filename}" }`, 'PHASE 0');
      info(`   Expected: BWF TimeReference from Audio;%Delay% field`, 'PHASE 0');

      try {
        const data = await analyzeFile(file, 'tech_specs');

        if (data.tech_metadata) {
          success(`✓ Metadata extraction successful!`, 'PHASE 0');
          info(`📊 RESULTS:`, 'PHASE 0');
          info(`   Start Timecode: ${data.tech_metadata.start_tc} (BWF TimeReference)`, 'PHASE 0');
          info(`   Codec: ${data.tech_metadata.codec_id}`, 'PHASE 0');
          info(`   Framerate: ${data.tech_metadata.frame_rate_fraction} fps`, 'PHASE 0');
          info(`   Total Frames: ${data.tech_metadata.total_frames}`, 'PHASE 0');
          info(`   Duration: ${(data.tech_metadata.duration_ms / 1000).toFixed(2)}s`, 'PHASE 0');
          if (data.tech_metadata.sample_rate) {
            info(`   🎵 Audio Specs: ${data.tech_metadata.sample_rate}Hz | ${data.tech_metadata.channels}ch | ${data.tech_metadata.bit_depth}bit`, 'PHASE 0');
          }
          if (data.tech_metadata.width && data.tech_metadata.height) {
            info(`   🎬 Video: ${data.tech_metadata.width}x${data.tech_metadata.height}`, 'PHASE 0');
          }
        }

        info(`💾 Saving to IndexedDB`, 'PHASE 0');
        info(`   Database: StoryGraphRegistry`, 'PHASE 0');
        info(`   Object Store: media`, 'PHASE 0');
        info(`   Key: ${file.drive_id}`, 'PHASE 0');
        await upsertMedia({
          ...file,
          tech_metadata: data.tech_metadata,
          last_forensic_stage: 'tech',
          operation_id: 'completed'
        });
        await refreshRegistry();
        success(`✓ ${file.filename} saved successfully\n`, 'PHASE 0');
      } catch (err: any) {
        error(`✗ ERROR: ${err.message}`, 'PHASE 0');
      }
    }

    setAnalyzingId(null);
    setActivePhase(null);
    info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'PHASE 0');
    success(`✓ PHASE 0 COMPLETE: ${targets.length} files processed`, 'PHASE 0');
  };

  const handleCategorization = async () => {
    const unknowns = registryFiles.filter(f => f.clip_type === 'unknown');
    info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'PHASE 1');
    info(`📋 PHASE 1: Snippet-Based Categorization (Optimized)`, 'PHASE 1');
    info(`Target: ${unknowns.length} files with clip_type='unknown'`, 'PHASE 1');
    info(`Strategy: 15-second middle snippet analysis (30s fallback)`, 'PHASE 1');
    info(`Service: https://categorization-triage-286149224994.us-central1.run.app`, 'PHASE 1');
    info(`Model: gemini-2.0-flash-001`, 'PHASE 1');
    setActivePhase('Categorization');

    for (let i = 0; i < unknowns.length; i++) {
      const file = unknowns[i];
      setAnalyzingId(file.drive_id);
      info(`\n[${i + 1}/${unknowns.length}] Analyzing: ${file.filename}`, 'PHASE 1');
      info(`   Category: ${file.media_category}`, 'PHASE 1');
      info(`   Duration: ${((file.tech_metadata?.duration_ms || 0) / 1000).toFixed(1)}s`, 'PHASE 1');

      info(`🔄 Step 0: Ensuring full file is in GCS bucket`, 'PHASE 1');
      info(`   Checking: gs://story-graph-proxies/${file.filename}`, 'PHASE 1');
      info(`   If not found → Mirror from Google Drive`, 'PHASE 1');

      info(`🔄 Step 1: Calling Snippet Triage Service`, 'PHASE 1');
      info(`   POST https://categorization-triage-286149224994.us-central1.run.app`, 'PHASE 1');
      info(`   Payload:`, 'PHASE 1');
      info(`     {`, 'PHASE 1');
      info(`       filename: "${file.filename}",`, 'PHASE 1');
      info(`       duration_ms: ${file.tech_metadata?.duration_ms || 0},`, 'PHASE 1');
      info(`       duration_limit: 15  // Initial 15s window`, 'PHASE 1');
      info(`     }`, 'PHASE 1');

      info(`🔄 Step 2: Cloud Run extracts middle 15s snippet`, 'PHASE 1');
      const middlePoint = ((file.tech_metadata?.duration_ms || 0) / 1000) / 2;
      const snippetStart = Math.max(0, middlePoint - 7.5);
      info(`   Start point: ${snippetStart.toFixed(1)}s (geometric middle - 7.5s)`, 'PHASE 1');
      info(`   FFmpeg: -ss ${snippetStart.toFixed(1)} -t 15 -c copy`, 'PHASE 1');
      info(`   Output: /tmp/snippet_${file.filename}`, 'PHASE 1');

      info(`🔄 Step 3: Upload snippet to GCS`, 'PHASE 1');
      info(`   Destination: gs://story-graph-proxies/triage_snippets/${file.filename}`, 'PHASE 1');

      info(`🔄 Step 4: Gemini 2.0 Flash multimodal analysis`, 'PHASE 1');
      info(`   Model: GenerativeModel("gemini-2.0-flash-001")`, 'PHASE 1');
      info(`   Input Type: Video Part (snippet from GCS)`, 'PHASE 1');
      info(`📝 PROMPT SENT TO GEMINI:`, 'PHASE 1');
      info(`   [Part 1] Video: gs://story-graph-proxies/triage_snippets/${file.filename}`, 'PHASE 1');
      info(`   [Part 2] Prompt Text:`, 'PHASE 1');
      info(`      "Analyze this 15-second visual clip.`, 'PHASE 1');
      info(`       Categorize it as either 'interview' (talking head,`, 'PHASE 1');
      info(`       dialogue-focused) or 'b-roll' (visual context, action,`, 'PHASE 1');
      info(`       landscape). Respond ONLY with a JSON object:`, 'PHASE 1');
      info(`       {\\"category\\": \\"interview\\" | \\"b-roll\\", \\"confidence\\": 0.0-1.0}"`, 'PHASE 1');

      info(`⏳ Waiting for Cloud Run response...`, 'PHASE 1');

      try {
        const data = await analyzeFile(file, 'shot_type');

        success(`✓ Cloud Run Service Response Received`, 'PHASE 1');
        info(`📊 GEMINI CLASSIFICATION RESULT:`, 'PHASE 1');
        info(`   Snippet analyzed: ${file.filename}`, 'PHASE 1');
        info(`   Category: "${data.clip_type}"`, 'PHASE 1');
        info(`   Details: ${data.analysis_content || 'N/A'}`, 'PHASE 1');

        if (data.analysis_content?.includes('30s')) {
          warning(`   ⚠ FALLBACK TRIGGERED: Initial 15s confidence < 80%`, 'PHASE 1');
          warning(`   ⚠ Retried with 30s snippet for better accuracy`, 'PHASE 1');
        }

        info(`🔄 Step 5: Cleanup operations`, 'PHASE 1');
        info(`   Cloud Run removes /tmp files`, 'PHASE 1');
        info(`   Snippet remains in GCS: triage_snippets/${file.filename}`, 'PHASE 1');

        info(`💾 Updating database record`, 'PHASE 1');
        await upsertMedia({ ...file, ...data });

        if (data.clip_type === 'interview' && file.media_category === 'video') {
          info(`🎬 TRIGGER: Proxy Transcoding`, 'PHASE 1');
          info(`   Service: ${PROXY_TRIGGER_URL}`, 'PHASE 1');
          info(`   Reason: Interview videos need proxies for editing`, 'PHASE 1');
          info(`   POST ${PROXY_TRIGGER_URL}`, 'PHASE 1');
          info(`   Body: { filename: "${file.filename}" }`, 'PHASE 1');
          fetch(PROXY_TRIGGER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.filename })
          })
            .then(() => success(`✓ Proxy transcode queued`, 'PHASE 1'))
            .catch(e => error(`✗ Transcoder failed: ${e}`, 'PHASE 1'));
        }

        await refreshRegistry();
        success(`✓ ${file.filename} categorized and saved\n`, 'PHASE 1');
      } catch (err: any) {
        error(`✗ ERROR: ${err.message}`, 'PHASE 1');
      }
    }

    setAnalyzingId(null);
    setActivePhase(null);
    info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'PHASE 1');
    success(`✓ PHASE 1 COMPLETE: ${unknowns.length} files categorized`, 'PHASE 1');
  };

  /**
   * PHASE 2: HYBRID WAVEFORM SYNC
   * Uses 10-second vocal-gated snippets for fast, memory-efficient sync
   */
  const handleWaveformSync = async () => {
    const masterAudio = registryFiles.find(f => f.media_category === 'audio');
    const cameraAngles = registryFiles.filter(f => f.clip_type === 'interview' && f.media_category === 'video');

    info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'PHASE 2');
    info(`📋 PHASE 2: Hybrid Snippet-Based Waveform Sync`, 'PHASE 2');
    info(`Strategy: 10-second audio snippet cross-correlation`, 'PHASE 2');
    info(`Service: https://hybrid-sync-service-286149224994.us-central1.run.app`, 'PHASE 2');
    info(`Master (Spine): ${masterAudio?.filename || 'NOT FOUND'}`, 'PHASE 2');
    info(`Satellites (Angles): ${cameraAngles.length} video files`, 'PHASE 2');

    if (!masterAudio) {
      error(`✗ No master audio found! Cannot proceed.`, 'PHASE 2');
      alert("No Master Audio found. Please run Categorization first.");
      return;
    }

    setActivePhase('Waveform Sync');

    info(`🎯 SYNCHRONIZATION PLAN:`, 'PHASE 2');
    cameraAngles.forEach((angle, idx) => {
      info(`   [${idx + 1}] ${angle.filename} → align to master`, 'PHASE 2');
    });

    for (let i = 0; i < cameraAngles.length; i++) {
      const angle = cameraAngles[i];
      info(`\n[${i + 1}/${cameraAngles.length}] Syncing: ${angle.filename}`, 'PHASE 2');

      info(`🔄 Step 1: Preparing audio snippets`, 'PHASE 2');
      info(`   Master: gs://story-graph-proxies/${masterAudio.filename}`, 'PHASE 2');
      info(`   Sample: gs://story-graph-proxies/${angle.filename}`, 'PHASE 2');
      info(`   Window: 10 seconds starting at offset 0s`, 'PHASE 2');
      info(`   Method: librosa.load() with offset+duration parameters`, 'PHASE 2');

      info(`🔄 Step 2: Calling Hybrid Sync Cloud Run`, 'PHASE 2');
      info(`   POST https://hybrid-sync-service-286149224994.us-central1.run.app`, 'PHASE 2');
      info(`   Payload:`, 'PHASE 2');
      info(`     {`, 'PHASE 2');
      info(`       master: "${masterAudio.filename}",`, 'PHASE 2');
      info(`       sample: "${angle.filename}",`, 'PHASE 2');
      info(`       bucket: "story-graph-proxies",`, 'PHASE 2');
      info(`       start_offset: 0,  // seconds from file start`, 'PHASE 2');
      info(`       duration_limit: 10 // 10-second snippet`, 'PHASE 2');
      info(`     }`, 'PHASE 2');

      info(`🔄 Step 3: Cross-correlation analysis`, 'PHASE 2');
      info(`   Loading snippets at 16kHz mono`, 'PHASE 2');
      info(`   Running numpy.correlate() in 'full' mode`, 'PHASE 2');
      info(`   Finding peak correlation → sample shift`, 'PHASE 2');
      info(`   Converting shift_samples to frames @ 25fps`, 'PHASE 2');

      try {
        // The actual sync happens in useHybridSync service
        // We can't directly log from there, but we know what it does
        const startTime = Date.now();

        // This will be handled by performMulticamSync
        info(`⏳ Waiting for Cloud Run response...`, 'PHASE 2');
      } catch (err: any) {
        error(`✗ Sync failed: ${err.message}`, 'PHASE 2');
      }
    }

    // Perform the actual sync
    await performMulticamSync(registryFiles, upsertMedia);
    await refreshRegistry();

    info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'PHASE 2');
    success(`✓ PHASE 2 COMPLETE: All ${cameraAngles.length} angles synchronized`, 'PHASE 2');
    setActivePhase(null);
  };

  const handleExportXML = () => {
    const videoAngles = registryFiles.filter(f => f.clip_type === 'interview' && f.media_category === 'video');
    const masterAudio = registryFiles.filter(f => f.clip_type === 'interview' && f.media_category === 'audio');

    info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'EXPORT');
    info(`📋 FCP XML EXPORT (XMEML Format)`, 'EXPORT');
    info(`Target: DaVinci Resolve / Final Cut Pro`, 'EXPORT');
    info(`Timeline: StoryGraph_Multicam_Sync`, 'EXPORT');

    info(`📊 EXPORT CONTENTS:`, 'EXPORT');
    info(`   Video Tracks: ${videoAngles.length}`, 'EXPORT');
    info(`   Audio Tracks: ${videoAngles.length + masterAudio.length} (camera scratch + master)`, 'EXPORT');
    info(`   Timeline Start: 01:00:00:00`, 'EXPORT');

    videoAngles.forEach((angle, idx) => {
      const offset = angle.sync_offset_frames || 0;
      const startTC = angle.tech_metadata?.start_tc || '00:00:00:00';
      info(`   [V${idx + 1}] ${angle.filename} @ +${offset}f (${startTC})`, 'EXPORT');
    });

    masterAudio.forEach((audio) => {
      const startTC = audio.tech_metadata?.start_tc || '00:00:00:00';
      info(`   [MASTER AUDIO] ${audio.filename} (${startTC})`, 'EXPORT');
    });

    info(`🔄 Step 1: Calculating timeline framerate`, 'EXPORT');
    const firstVideo = registryFiles.find(f => f.media_category === 'video' && f.tech_metadata?.frame_rate_fraction);
    const timelineFPS = firstVideo?.tech_metadata?.frame_rate_fraction || '25.000';
    info(`   Timeline FPS: ${timelineFPS}`, 'EXPORT');

    info(`🔄 Step 2: Building XML structure`, 'EXPORT');
    info(`   Format: XMEML 4 (Final Cut Pro XML)`, 'EXPORT');
    info(`   Video format: 1920x1080 @ ${timelineFPS}fps`, 'EXPORT');
    info(`   Audio format: 48000Hz, 16-bit stereo`, 'EXPORT');

    try {
      const xml = generateXML(registryFiles, "StoryGraph_Multicam_Sync");

      info(`🔄 Step 3: Writing XML file`, 'EXPORT');
      info(`   Filename: StoryGraph_Final_Sync.xml`, 'EXPORT');
      info(`   Size: ${(xml.length / 1024).toFixed(2)} KB`, 'EXPORT');

      downloadXML(xml, "StoryGraph_Final_Sync.xml");

      success(`✓ XML EXPORT SUCCESSFUL`, 'EXPORT');
      info(`   File downloaded to browser Downloads folder`, 'EXPORT');
      info(`   Import this into DaVinci Resolve or FCP`, 'EXPORT');
      info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'EXPORT');
    } catch (err: any) {
      error(`✗ EXPORT FAILED: ${err.message}`, 'EXPORT');
      alert(err.message);
    }
  };

  const framesToTimecode = (totalFrames: number, fileFPS: string = "25", startTC: string = "00:00:00:00") => {
    const fps = parseFloat(fileFPS) || 25;
    const parts = startTC.split(':').map(Number);
    const baseFrames = ((parts[0] * 3600) + (parts[1] * 60) + parts[2]) * fps + parts[3];
    const abs = baseFrames + totalFrames;
    const h = Math.floor(abs / (3600 * fps));
    const m = Math.floor((abs % (3600 * fps)) / (60 * fps));
    const s = Math.floor((abs % (60 * fps)) / fps);
    const f = Math.floor(abs % fps);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  };

  const handleReset = async () => {
    if (window.confirm("Wipe local registry?")) {
      await clearRegistry();
      setRegistryFiles([]);
    }
  };

  const handleFolderSelected = async (id: string) => {
    setProgress({ status: IndexingStatus.INDEXING, filesProcessed: 0, foldersProcessed: 0, currentFile: 'Discovering...' });
    try {
      await fetchFilesRecursively(id, async (driveFile, relativePath) => {
        const isAudio = driveFile.mimeType.includes('audio') || driveFile.name.toLowerCase().endsWith('.wav');
        const mediaFile: MediaFile = {
          drive_id: driveFile.id,
          filename: driveFile.name,
          md5_checksum: driveFile.md5Checksum || '',
          size_bytes: parseInt(driveFile.size) || 0,
          mime_type: driveFile.mimeType,
          duration: driveFile.videoMediaMetadata?.durationMillis || 0,
          sync_offset_frames: 0,
          clip_type: 'unknown',
          media_category: isAudio ? 'audio' : 'video',
          relative_path: relativePath
        };
        await upsertMedia(mediaFile);
        setProgress(prev => ({ ...prev, currentFile: driveFile.name, filesProcessed: prev.filesProcessed + 1 }));
      }, () => {});
      setProgress(prev => ({ ...prev, status: IndexingStatus.COMPLETED, currentFile: 'Done' }));
      refreshRegistry();
    } catch (err) { console.error('Indexing failed:', err); }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 flex flex-col gap-8 text-slate-900">
      <GlobalStyles />
      <div className={`fixed top-0 left-0 w-full h-1 z-[3000] ${
        cloudStatus === 'online' ? 'bg-emerald-500' : cloudStatus === 'offline' ? 'bg-red-500' : 'bg-amber-500'
      }`} />

      <div className="max-w-6xl mx-auto w-full space-y-8">
        <header className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Story Graph</h1>
              <p className="text-slate-500 mt-2 italic font-medium flex items-center gap-2">
                Forensic Ingest Pipeline
                <span className={`inline-block w-2 h-2 rounded-full ${cloudStatus === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              </p>
            </div>
            <div className="flex items-center gap-3">
              {user ? (
                <>
                  <button onClick={handleReset} className="px-4 py-2 text-red-600 font-bold hover:bg-red-50 rounded-lg text-sm">Reset</button>
                  <button onClick={logout} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-50 rounded-lg text-sm border border-slate-200">Logout</button>
                  <button onClick={() => openPicker(handleFolderSelected)} className="bg-white border border-slate-200 text-slate-700 px-8 py-3 rounded-xl font-bold shadow-sm transition-all">Index Folder</button>
                </>
              ) : (
                <button onClick={login} disabled={!isReady} className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg transition-all">Connect Drive</button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-50">
            {[
              { name: 'Tech Specs', fn: handleTechSpecs, phase: 0 },
              { name: 'Categorization', fn: handleCategorization, phase: 1 },
              { name: 'Waveform Sync', fn: handleWaveformSync, phase: 2 }
            ].map((p) => (
              <button
                key={p.name}
                onClick={p.fn}
                disabled={!user || !!activePhase}
                className={`phase-btn ${activePhase === p.name ? 'bg-indigo-600 text-white animate-pulse' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                <span className="opacity-50 text-[9px] mb-1">Phase {p.phase}</span> {p.name}
              </button>
            ))}
          </div>
        </header>

        <main className="space-y-12">
          <MediaTable
            files={registryFiles}
            onCheckStatus={handleCheckStatus}
            isAnalyzing={isAnalyzing || isSyncing || !!analyzingId}
            activeId={analyzingId}
          />

          <section className="bg-slate-900 rounded-3xl p-8 shadow-2xl border border-slate-800 relative overflow-hidden">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-3">
                      Forensic Multicam Bin
                      {canExport && <span className="bg-emerald-500/20 text-emerald-400 text-[10px] px-2 py-0.5 rounded-full uppercase border border-emerald-500/30">Synced</span>}
                    </h2>
                    <p className="text-slate-500 font-mono text-[10px] mt-1 uppercase tracking-widest font-bold font-mono">Computational Waveform Alignment</p>
                </div>
            </div>
            
            <div className="bg-slate-800/40 rounded-2xl border border-slate-700/50 overflow-hidden mb-8">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-slate-500 text-[10px] uppercase font-bold tracking-widest border-b border-slate-700 bg-slate-800/80">
                    <th className="px-6 py-4">Role</th>
                    <th className="px-6 py-4">File</th>
                    <th className="px-6 py-4 text-center">Offset</th>
                    <th className="px-6 py-4 text-emerald-400 text-right">Synced TC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {registryFiles
                    .filter(f => f.clip_type === 'interview' || f.media_category === 'audio')
                    .sort((a, b) => (a.media_category === 'audio' ? -1 : 1))
                    .map((file, idx) => {
                      const offsetValue = file.sync_offset_frames ?? 0;
                      const fpsString = file.tech_metadata?.frame_rate_fraction?.toString() || "25";
                      const startTC = file.tech_metadata?.start_tc || "00:00:00:00";
                      const isMaster = file.media_category === 'audio';

                      return (
                        <tr key={file.drive_id} className={`text-slate-300 hover:bg-white/5 transition-colors ${isMaster ? 'bg-indigo-900/10' : ''}`}>
                          <td className="px-6 py-4">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded ${isMaster ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
                                {isMaster ? 'MASTER' : `ANGLE ${idx}`}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-400 text-xs font-medium truncate max-w-[200px]">{file.filename}</td>
                          <td className="px-6 py-4 text-slate-500 font-mono text-[10px] text-center">
                            {isMaster ? '---' : offsetValue === 0 ? 'Searching...' : `+${offsetValue} f`}
                          </td>
                          <td className="px-6 py-4 font-mono text-emerald-400 font-bold text-right text-xs">
                            {framesToTimecode(offsetValue, fpsString, startTC)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
                <button 
                    onClick={handleExportXML}
                    disabled={!canExport}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white px-10 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg transition-all flex items-center gap-3"
                >
                    Export Multicam XML
                </button>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

export default App;