import { useState, useCallback, useEffect } from 'react';
import { MediaFile } from '../types';

export const useRegistry = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      // Version 1 of the StoryGraphRegistry
      const request = indexedDB.open('StoryGraphRegistry', 1);
      
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('media')) {
          // drive_id serves as our unique primary key for Google Drive assets
          db.createObjectStore('media', { keyPath: 'drive_id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  useEffect(() => {
    openDB()
      .then(() => setLoading(false))
      .catch((err) => {
        console.error('[Registry] Initialization failed:', err);
        setError('Failed to initialize local database.');
        setLoading(false);
      });
  }, []);

  const upsertMedia = useCallback(async (file: MediaFile) => {
    try {
      const db = await openDB();
      const tx = db.transaction('media', 'readwrite');
      const store = tx.objectStore('media');

      /**
       * DATA SANITIZATION LAYER
       * Cloud Run returns high-precision metadata as strings.
       * We sanitize them here so our "Editing Physics" logic (ASL, Offset Math)
       * can use standard JavaScript number operations.
       */
      const sanitizedFile: MediaFile = {
        ...file,
        tech_metadata: file.tech_metadata ? {
          ...file.tech_metadata,
          // Convert "25.000" or "23.976" string to float
          frame_rate_fraction: typeof file.tech_metadata.frame_rate_fraction === 'string'
            ? parseFloat(file.tech_metadata.frame_rate_fraction) as any
            : file.tech_metadata.frame_rate_fraction,
          
          // Convert "1542" string to integer
          total_frames: typeof file.tech_metadata.total_frames === 'string'
            ? parseInt(file.tech_metadata.total_frames, 10) as any
            : file.tech_metadata.total_frames,

          // Ensure start_tc is never undefined (defaulting to SMPTE midnight)
          start_tc: file.tech_metadata.start_tc || "00:00:00:00"
        } : file.tech_metadata
      };
      
      return new Promise<void>((resolve, reject) => {
        const request = store.put(sanitizedFile);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('[Registry] Upsert failed:', err);
    }
  }, []);

  const getAllMedia = useCallback(async (): Promise<MediaFile[]> => {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('media', 'readonly');
        const store = tx.objectStore('media');
        const request = store.getAll();
        
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('[Registry] Fetch failed:', err);
      return [];
    }
  }, []);

  // NEW: Hard Reset functionality to clear "ghost" data from previous sessions
  const clearRegistry = useCallback(async () => {
    try {
      const db = await openDB();
      const tx = db.transaction('media', 'readwrite');
      const store = tx.objectStore('media');
      
      return new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => {
          console.log('[Registry] Database cleared successfully.');
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('[Registry] Clear failed:', err);
    }
  }, []);

  return { loading, error, upsertMedia, getAllMedia, clearRegistry };
};