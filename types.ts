/**
 * CORE TYPES: STORY GRAPH DATABASE SCHEMA
 * Version: 4.0 (Production Hybrid Sync)
 */

export interface TechnicalMetadata {
  // SMPTE truth for professional NLE conform (Resolve/Premiere)
  start_tc: string;              // e.g., "00:49:50:00" from BWF TimeReference

  // Visual Specs
  width: number;                 // 0 for audio files
  height: number;                // 0 for audio files
  frame_rate_fraction: string;   // "25.000" - stored as string for precision
  total_frames: string;

  // Codec & Container specs
  codec_id: string;              // e.g., "PCM", "AAC", "AVC", "ProRes"
  duration_ms: number;           // Milliseconds for UI progress/math

  // Professional Audio specs (Critical for ZOOM F6 / Spine Nodes)
  sample_rate?: number;          // e.g., 48000
  channels?: number;             // e.g., 6 (polyphonic wav)
  bit_depth?: number;            // e.g., 32 (float)

  // Identification
  reel_name?: string;            // PPRO/Resolve metadata matching
}

/**
 * NARRATIVE ATOMIC UNITS
 * Allows Gemini to edit by word/sentence/segment
 */
export interface NarrativeWord {
  word_id: string;
  text: string;
  start_tc: string;   // Relates to the SYNCED CONTAINER, not the raw clip
  end_tc: string;
  confidence: number;
}

export interface NarrativeSentence {
  sentence_id: string;
  text: string;
  is_fluff: boolean;  // Gemini flagged (e.g. "um", "like")
  sentiment_score: number;
  words: NarrativeWord[];
}

export interface NarrativeSegment {
  segment_id: string;
  speaker_label: string;
  start_tc: string;
  end_tc: string;
  sentences: NarrativeSentence[];
}

export interface MediaFile {
  drive_id: string;
  filename: string;
  md5_checksum: string;
  size_bytes: number;
  mime_type: string;
  
  // Total frames offset from the global "Anchor Frame" (01:00:00:00)
  sync_offset_frames: number;
  
  // Native Drive duration (ms)
  duration?: number;
  
  // --- Forensic Pipeline Fields ---
  media_category: 'video' | 'audio'; 
  
  // Category assigned by Gemini Assessment
  clip_type: 'interview' | 'b-roll' | 'external_audio' | 'location_sound' | 'unknown';
  
  // Ingest State Tracking
  operation_id?: string;
  last_forensic_stage?: 'light' | 'heavy' | 'tech' | 'sync' | 'parsed';
  
  // Transcription & Semantic Layers
  analysis_content?: string; // Summary or raw transcript text
  narrative_segments?: NarrativeSegment[]; // [NEW] The Atomic units

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