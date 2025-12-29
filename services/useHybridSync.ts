import { useState, useCallback } from 'react';
import { MediaFile } from '../types';

/**
 * Service: Hybrid Snippet-Based Multicam Sync
 * Uses 10-second vocal-gated snippets for fast, memory-efficient sync
 */
export const useHybridSync = () => {
  const [isSyncing, setIsSyncing] = useState(false);

  // The endpoint for the Hybrid Sync Cloud Run service
  const HYBRID_SERVICE_URL = 'https://hybrid-sync-service-286149224994.us-central1.run.app';

  /**
   * Calculate offset for a single satellite against the master spine
   */
  const calculateOffset = async (
    masterFile: string,
    sampleFile: string,
    startOffset: number = 0,
    duration: number = 10
  ): Promise<number> => {
    try {
      console.log(`[HybridSync] Syncing: ${sampleFile} against ${masterFile}`);

      const response = await fetch(HYBRID_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master: masterFile,
          sample: sampleFile,
          bucket: 'story-graph-proxies',
          start_offset: startOffset,  // Seconds from start (transcript-derived in future)
          duration_limit: duration    // 10s snippet window
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[HybridSync] Service returned ${response.status}:`, errorText);
        throw new Error(`Hybrid Sync Failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log(`[HybridSync] ✓ Result:`, data);

      return data.hybrid_offset_frames || 0;
    } catch (err) {
      console.error("[HybridSync] Alignment failed:", err);
      throw err;
    }
  };

  /**
   * Main sync orchestration - processes all camera angles against master audio
   */
  const performMulticamSync = useCallback(async (
    files: MediaFile[],
    upsertMedia: (file: MediaFile) => Promise<void>
  ) => {
    setIsSyncing(true);

    // 1. Identify the Master Audio (The Spine)
    const masterAudio = files.find(f => f.media_category === 'audio');
    const cameraAngles = files.filter(f => f.clip_type === 'interview' && f.media_category === 'video');

    if (!masterAudio) {
      alert("No Master Audio found. Please run Categorization first.");
      setIsSyncing(false);
      return;
    }

    console.log(`%c[HybridSync] Anchoring ${cameraAngles.length} angles to Master: ${masterAudio.filename}`, "color: #10b981; font-weight: bold;");

    // 2. Align each angle using hybrid snippet sync
    for (const angle of cameraAngles) {
      try {
        const offset = await calculateOffset(
          masterAudio.filename,
          angle.filename,
          0,  // TODO: In future, derive from transcript word timing
          10  // 10-second snippet window
        );

        await upsertMedia({
          ...angle,
          sync_offset_frames: offset,
          last_forensic_stage: 'sync'
        });

        console.log(`✓ ${angle.filename}: ${offset} frames`);
      } catch (err) {
        console.error(`[HybridSync] Failed to sync ${angle.filename}:`, err);
        alert(`Failed to sync ${angle.filename}. Check console for details.`);
      }
    }

    setIsSyncing(false);
    console.log("%c[HybridSync] Multicam Bin Unified.", "color: #10b981; font-weight: bold;");
  }, []);

  return { performMulticamSync, isSyncing };
};
