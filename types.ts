export interface TechnicalMetadata {
  // SMPTE truth for professional NLE conform (Resolve/Premiere)
  start_tc: string;              // e.g., "05:10:24:00" from MediaInfo/Zoom
  
  // Visual Specs
  width: number;                 // 0 for audio files
  height: number;                // 0 for audio files
  frame_rate_fraction: string;   // "25.000" - stored as string to keep precision for parseFloat
  total_frames: string;          // stored as string to avoid precision loss on large integers
  
  // Codec & Container specs
  codec_id: string;              // e.g., "PCM", "AAC", "AVC", "ProRes"
  duration_ms: number;           // Milliseconds for UI progress/math
  
  // NEW: Professional Audio specs (Critical for ZOOM F6 / Spine Nodes)
  sample_rate?: number;          // e.g., 48000 or 44100
  channels?: number;             // e.g., 2 (stereo) or 6 (polyphonic wav)
  bit_depth?: number;            // e.g., 24 or 32
  
  // Identification
  reel_name?: string;            // Map from %Producer% or %Description% if available
}

export interface MediaFile {
  drive_id: string;
  filename: string;
  md5_checksum: string;
  size_bytes: number;
  mime_type: string;
  
  // Total frames offset from the global "Anchor Frame" (01:00:00:00)
  sync_offset_frames: number;
  last_forensic_stage?: 'light' | 'heavy' | 'tech' | 'sync'; // Added 'sync'
  
  // Native Drive duration (ms)
  duration?: number;
  
  // --- Forensic Pipeline Fields ---
  media_category: 'video' | 'audio'; 
  
  // unknown: Needs triage
  // interview: Becomes a Spine Node
  // b-roll: Becomes a Satellite Node
  clip_type: 'interview' | 'b-roll' | 'unknown';
  
  // operation_id state:
  // undefined: No forensic started
  // 'light_complete': Triage finished
  // [GCP_OP_ID]: Long-running cloud job ID
  // 'completed': Fully indexed
  // 'error': Failed
  operation_id?: string;
  
  // Summary/Transcript storage
  analysis_content?: string; 

  // Tracking the last forensic milestone reached
  last_forensic_stage?: 'light' | 'heavy' | 'tech';

  // The "Source of Truth" from the Cloud Extractor
  tech_metadata?: TechnicalMetadata;
  
  // Path for XML reconstruction (e.g., "Raw/CamA/")
  relative_path?: string;
}

export enum IndexingStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  INDEXING = 'INDEXING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface IndexingProgress {
  status: IndexingStatus;
  currentFile?: string;
  filesProcessed: number;
  foldersProcessed: number;
  error?: string;
}