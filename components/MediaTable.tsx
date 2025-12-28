import React from 'react';
import { MediaFile } from '../types';

interface MediaTableProps {
  files: MediaFile[];
  onCheckStatus: (file: MediaFile) => void;
  isAnalyzing: boolean;
  activeId: string | null;
}

export const MediaTable: React.FC<MediaTableProps> = ({ 
  files, 
  onCheckStatus, 
  isAnalyzing, 
  activeId 
}) => {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">Asset Discovery</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">Editorial Role</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">Source of Truth (Specs)</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-slate-500 text-right">Pipeline Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {files.map((file) => {
              const isCurrent = activeId === file.drive_id;
              const hasTech = !!file.tech_metadata;

              return (
                <tr 
                  key={file.drive_id} 
                  className={`hover:bg-slate-50/50 transition-colors ${isCurrent ? 'bg-indigo-50/30' : ''}`}
                >
                  {/* COLUMN 1: Asset Identification */}
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-slate-900 truncate max-w-[240px]" title={file.filename}>
                        {file.filename}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {(file.size_bytes / (1024 * 1024)).toFixed(2)} MB • {file.mime_type.split('/')[1].toUpperCase()}
                      </span>
                    </div>
                  </td>
                  
                  {/* COLUMN 2: Category/Role */}
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <span className={`w-fit px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter border ${
                        file.media_category === 'video' 
                          ? 'bg-amber-50 text-amber-600 border-amber-100' 
                          : 'bg-indigo-50 text-indigo-600 border-indigo-100'
                      }`}>
                        {file.media_category}
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium italic">
                        {file.clip_type === 'unknown' ? 'Unassigned' : file.clip_type}
                      </span>
                    </div>
                  </td>

                  {/* COLUMN 3: Technical Metadata (Phase 0 Results) */}
                  <td className="px-6 py-4">
                    {hasTech ? (
                      <div className="flex flex-col gap-1 border-l-2 border-indigo-500 pl-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono font-bold text-slate-900">
                            {file.tech_metadata?.start_tc}
                          </span>
                          <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-1 rounded">
                            {file.tech_metadata?.frame_rate_fraction} FPS
                          </span>
                        </div>
                        <div className="text-[9px] text-slate-400 uppercase tracking-tight font-semibold flex items-center gap-1.5">
                          <span>{file.tech_metadata?.codec_id}</span>
                          <span className="text-slate-200">|</span>
                          <span>{file.tech_metadata?.total_frames} Frames</span>
                          {file.tech_metadata?.width !== 0 && (
                            <>
                              <span className="text-slate-200">|</span>
                              <span>{file.tech_metadata?.width}x{file.tech_metadata?.height}</span>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-slate-300">
                        <div className="w-1.5 h-1.5 bg-slate-200 rounded-full animate-pulse" />
                        <span className="text-[10px] italic">Awaiting Forensic Tech Pass</span>
                      </div>
                    )}
                  </td>

                  {/* COLUMN 4: Status Bar */}
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {isCurrent ? (
                        <div className="flex items-center gap-2 text-indigo-600 font-black text-[10px] uppercase tracking-widest bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
                          <div className="w-2 h-2 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                          Extracting
                        </div>
                      ) : (
                        <div className="flex flex-col items-end">
                          <span className={`text-[10px] font-bold uppercase tracking-tight ${
                            file.operation_id === 'completed' ? 'text-emerald-500' : 'text-slate-400'
                          }`}>
                            {file.operation_id === 'completed' ? '✓ Tech Verified' : 'Ready'}
                          </span>
                          {file.last_forensic_stage === 'tech' && (
                            <span className="text-[8px] text-slate-300 uppercase font-bold">GCS Mirrored</span>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Empty State */}
      {files.length === 0 && (
        <div className="p-16 text-center flex flex-col items-center">
          <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-dashed border-slate-200">
            <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <h3 className="text-slate-900 font-bold text-sm">No Story Assets Detected</h3>
          <p className="text-slate-400 text-xs mt-1 max-w-[200px]">Index a Google Drive folder to begin the forensic ingestion process.</p>
        </div>
      )}
    </div>
  );
};