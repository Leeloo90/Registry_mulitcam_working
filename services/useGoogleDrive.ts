import { useState, useCallback, useEffect } from 'react';
import { GOOGLE_CONFIG } from '../config'; 
import { GoogleUser } from '../types';

declare global {
  interface Window {
    google: any;
    gapi: any;
  }
}

/**
 * Updated Scopes: 
 * We include 'cloud-platform' to grant the access token permission to call 
 * Gemini 1.5 Flash via Vertex AI.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/cloud-platform' // REQUIRED for Gemini/Vertex
].join(' ');

const TOKEN_STORAGE_KEY = 'google_drive_token';
const TOKEN_EXPIRY_KEY = 'google_drive_token_expiry';

export const useGoogleDrive = () => {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [isGapiLoaded, setIsGapiLoaded] = useState(false);
  const [isGsiLoaded, setIsGsiLoaded] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Restore saved token on mount
  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    const savedExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY);

    if (savedToken && savedExpiry) {
      const expiryTime = parseInt(savedExpiry);
      const now = Date.now();

      // Check if token is still valid (hasn't expired)
      if (now < expiryTime) {
        console.log('[Auth] Restored saved token from localStorage');
        setUser({ accessToken: savedToken });
      } else {
        console.log('[Auth] Saved token expired, clearing storage');
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(TOKEN_EXPIRY_KEY);
      }
    }
  }, []);

  useEffect(() => {
    const handleGapiLoad = () => {
      window.gapi.load('client:picker', async () => {
        try {
          // Initialize with Drive and Video Intelligence Discovery Docs
          await window.gapi.client.init({
            apiKey: GOOGLE_CONFIG.API_KEY,
            discoveryDocs: GOOGLE_CONFIG.DISCOVERY_DOCS,
          });
          console.log("[GAPI] Client initialized with Cloud Video & Drive features.");
          setIsGapiLoaded(true);
        } catch (error: any) {
          console.error("[GAPI] Init Error:", error);
          
          // Fallback if specific discovery docs fail
          try {
            await window.gapi.client.init({
              apiKey: GOOGLE_CONFIG.API_KEY,
              discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
            });
            setIsGapiLoaded(true);
          } catch (fallbackError) {
            setInitError("Critical Google Service Failure.");
          }
        }
      });
    };

    // Library Loading Checks
    const interval = setInterval(() => {
      if (window.gapi) {
        clearInterval(interval);
        handleGapiLoad();
      }
    }, 100);

    const gsiInterval = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(gsiInterval);
        setIsGsiLoaded(true);
      }
    }, 100);

    return () => {
      clearInterval(interval);
      clearInterval(gsiInterval);
    };
  }, []);

  /**
   * Updated Login:
   * Uses the joined SCOPES string including Vertex AI permissions.
   * Saves token to localStorage for persistence across sessions.
   */
  const login = useCallback(() => {
    if (!isGsiLoaded) return;
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CONFIG.CLIENT_ID,
      scope: SCOPES,
      callback: (response: any) => {
        if (response.access_token) {
          console.log("[Auth] Token received with Cloud & Drive privileges.");

          // Save token to localStorage
          localStorage.setItem(TOKEN_STORAGE_KEY, response.access_token);

          // Google OAuth tokens typically expire in 1 hour (3600 seconds)
          // We'll set expiry to 55 minutes to be safe
          const expiryTime = Date.now() + (55 * 60 * 1000);
          localStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString());

          console.log('[Auth] Token saved to localStorage');
          setUser({ accessToken: response.access_token });
        }
      },
    });
    tokenClient.requestAccessToken();
  }, [isGsiLoaded]);

  const openPicker = useCallback((onFolderSelected: (folderId: string, folderName: string) => void) => {
    if (!user || !isGapiLoaded) return;
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder');

    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(user.accessToken)
      .setDeveloperKey(GOOGLE_CONFIG.API_KEY)
      .setCallback((data: any) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const doc = data.docs[0];
          onFolderSelected(doc.id, doc.name);
        }
      })
      .build();
    picker.setVisible(true);
  }, [user, isGapiLoaded]);

  const logout = useCallback(() => {
    console.log('[Auth] Logging out and clearing saved token');
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    setUser(null);
  }, []);

  const fetchFilesRecursively = useCallback(async (
    folderId: string,
    onFileFound: (file: any) => void,
    onProgress: (count: number) => void
  ) => {
    if (!user) return;
    let processedCount = 0;
    const queue = [folderId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      let pageToken: string | undefined = undefined;

      try {
        do {
          const response = await window.gapi.client.drive.files.list({
            q: `'${currentId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, md5Checksum, size, mimeType, videoMediaMetadata)',
            pageToken: pageToken
          });

          const files = response.result.files || [];
          for (const file of files) {
            if (file.mimeType === 'application/vnd.google-apps.folder') {
              queue.push(file.id);
            } else if (file.mimeType.startsWith('video/') || file.mimeType.startsWith('audio/')) {
              // Extract duration for temporal sampling in Gemini
              const duration = file.videoMediaMetadata?.durationMillis
                ? parseInt(file.videoMediaMetadata.durationMillis) / 1000
                : 0;

              onFileFound({
                ...file,
                duration
              });
              processedCount++;
              onProgress(processedCount);
            }
          }
          pageToken = response.result.nextPageToken;
        } while (pageToken);
      } catch (err) {
        console.error("[Drive] Error listing files:", err);
      }
    }
  }, [user]);

  return {
    user,
    login,
    logout,
    openPicker,
    fetchFilesRecursively,
    isReady: isGapiLoaded && isGsiLoaded,
    initError
  };
};