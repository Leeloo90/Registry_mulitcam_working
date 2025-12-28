import { useCallback, useState } from 'react';
import { MediaFile } from '../types';

const SYNC_SERVICE_URL = 'https://media-sync-registry-286149224994.europe-west1.run.app'; // Your sync endpoint

export const useMediaSync = () => {
  const [isSyncing, setIsSyncing] = useState(false);

  /**
   * Cloud Orchestrator: Sends two files to the cloud to find the temporal offset.
   * Master = The absolute audio truth (Spine)
   * Sample = The camera angle to be shifted (Satellite)
   */
  const calculateOffset = async (masterFile: string, sampleFile: string): Promise<number> => {
    try {
      console.log(`[MediaSync] Requesting sync for: ${sampleFile} against ${masterFile}`);

      const response = await fetch(SYNC_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master: masterFile, // e.g., "ZOOM_F6_001.wav"
          sample: sampleFile, // e.g., "CAM_A_005.mp4"
          bucket: "story-graph-proxies"
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[MediaSync] Service returned ${response.status}:`, errorText);
        throw new Error(`Sync Service Failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log(`[MediaSync] ✓ Sync result:`, data);

      // The service returns offset in frames based on 25fps logic
      return data.offset_frames || 0;
    } catch (err) {
      console.error("[MediaSync] Alignment failed:", err);
      throw err; // Re-throw to let caller handle it
    }
  };

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

    console.log(`%c[Sync] Anchoring ${cameraAngles.length} angles to Master: ${masterAudio.filename}`, "color: #10b981; font-weight: bold;");

    // 2. Align each angle
    for (const angle of cameraAngles) {
      try {
        const offset = await calculateOffset(masterAudio.filename, angle.filename);

        await upsertMedia({
          ...angle,
          sync_offset_frames: offset,
          last_forensic_stage: 'sync' // Mark as fully synchronized
        });
      } catch (err) {
        console.error(`[MediaSync] Failed to sync ${angle.filename}:`, err);
        alert(`Failed to sync ${angle.filename}. Check console for details.`);
      }
    }

    setIsSyncing(false);
    console.log("%c[Sync] Multicam Bin Unified.", "color: #10b981; font-weight: bold;");
  }, []);

  return { performMulticamSync, isSyncing };
};