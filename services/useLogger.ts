import { useState, useCallback } from 'react';
import { LogEntry } from '../components/LogViewer';

export const useLogger = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback((
    message: string,
    level: LogEntry['level'] = 'info',
    phase?: string
  ) => {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      level,
      message,
      phase
    };

    setLogs(prev => [...prev, entry]);

    // Also log to console for debugging
    const consoleMethod = level === 'error' ? console.error : level === 'warning' ? console.warn : console.log;
    consoleMethod(`[${phase || 'LOG'}] ${message}`);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return {
    logs,
    addLog,
    clearLogs,
    info: (msg: string, phase?: string) => addLog(msg, 'info', phase),
    success: (msg: string, phase?: string) => addLog(msg, 'success', phase),
    warning: (msg: string, phase?: string) => addLog(msg, 'warning', phase),
    error: (msg: string, phase?: string) => addLog(msg, 'error', phase)
  };
};
