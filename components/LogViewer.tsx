import React, { useEffect, useRef } from 'react';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  phase?: string;
}

interface LogViewerProps {
  logs: LogEntry[];
  onClear: () => void;
}

export const LogViewer: React.FC<LogViewerProps> = ({ logs, onClear }) => {
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getLevelColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'success':
        return 'text-emerald-600 bg-emerald-50 border-emerald-200';
      case 'error':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'warning':
        return 'text-amber-600 bg-amber-50 border-amber-200';
      default:
        return 'text-slate-600 bg-slate-50 border-slate-200';
    }
  };

  const getLevelIcon = (level: LogEntry['level']) => {
    switch (level) {
      case 'success':
        return '✓';
      case 'error':
        return '✗';
      case 'warning':
        return '⚠';
      default:
        return '•';
    }
  };

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-700 shadow-lg overflow-hidden">
      <div className="bg-slate-800 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-red-500 rounded-full"></div>
          <div className="w-3 h-3 bg-amber-500 rounded-full"></div>
          <div className="w-3 h-3 bg-emerald-500 rounded-full"></div>
          <span className="text-slate-400 text-xs font-mono ml-4 uppercase tracking-wider font-bold">
            Live Pipeline Log
          </span>
        </div>
        <button
          onClick={onClear}
          className="text-slate-500 hover:text-slate-300 text-xs font-mono uppercase tracking-wider font-bold transition-colors"
        >
          Clear
        </button>
      </div>

      <div className="h-64 overflow-y-auto p-4 space-y-2 bg-slate-950 font-mono text-xs">
        {logs.length === 0 ? (
          <div className="text-slate-600 italic text-center py-8">
            Waiting for activity...
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className={`flex items-start gap-3 p-2 rounded border ${getLevelColor(log.level)}`}
            >
              <span className="font-bold text-sm flex-shrink-0">
                {getLevelIcon(log.level)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] opacity-60">
                    {log.timestamp.toLocaleTimeString()}
                  </span>
                  {log.phase && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-white/20 rounded uppercase tracking-wide font-black">
                      {log.phase}
                    </span>
                  )}
                </div>
                <div className="break-words">{log.message}</div>
              </div>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
};
