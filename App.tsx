import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MediaTable } from './components/MediaTable';
import { useRegistry } from './services/useRegistry';
import { useGoogleDrive } from './services/useGoogleDrive';
import { useForensicSurveyor } from './services/useForensicSurveyor';
import { useXMLExporter } from './services/useXMLExporter';
import { useMediaSync } from './services/useMediaSync'; // NEW
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
  const { user, login, openPicker, fetchFilesRecursively, isReady } = useGoogleDrive();
  const { loading: dbLoading, upsertMedia, getAllMedia, clearRegistry } = useRegistry();

  const { analyzeFile, getAnalysisResult, isAnalyzing } = useForensicSurveyor(user?.accessToken || null);
  const { generateXML, downloadXML } = useXMLExporter();
  const { performMulticamSync, isSyncing } = useMediaSync(); // NEW
  
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

  /**
   * PHASE 0: TECH SPECS
   */
  const handleTechSpecs = async () => {
    const targets = registryFiles.filter(f => !f.tech_metadata);
    setActivePhase('Tech Specs');
    for (const file of targets) {
      setAnalyzingId(file.drive_id);
      try {
        const data = await analyzeFile(file, 'tech_specs'); 
        await upsertMedia({ 
          ...file, 
          tech_metadata: data.tech_metadata,
          last_forensic_stage: 'tech',
          operation_id: 'completed'
        });
        await refreshRegistry();
      } catch (err) { console.error(err); }
    }
    setAnalyzingId(null);
    setActivePhase(null);
  };

  /**
   * PHASE 1: CATEGORIZATION
   */
  const handleCategorization = async () => {
    const unknowns = registryFiles.filter(f => f.clip_type === 'unknown');
    setActivePhase('Categorization');
    for (const file of unknowns) {
      setAnalyzingId(file.drive_id);
      try {
        const data = await analyzeFile(file, 'shot_type');
        await upsertMedia({ ...file, ...data });
        if (data.clip_type === 'interview' && file.media_category === 'video') {
          fetch(PROXY_TRIGGER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.filename })
          }).catch(e => console.error("Transcoder trigger failed", e));
        }
        await refreshRegistry();
      } catch (err) { console.error(err); }
    }
    setAnalyzingId(null);
    setActivePhase(null);
  };

  /**
   * PHASE 2: WAVEFORM SYNC (The Computational Orchestration)
   */
  const handleWaveformSync = async () => {
    setActivePhase('Waveform Sync');
    await performMulticamSync(registryFiles, upsertMedia);
    await refreshRegistry();
    setActivePhase(null);
  };

  const handleExportXML = () => {
    try {
      const xml = generateXML(registryFiles, "StoryGraph_Multicam_Sync");
      downloadXML(xml, "StoryGraph_Final_Sync.xml");
    } catch (err: any) {
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