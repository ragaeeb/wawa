import type { LogEntry, LogLevel } from '../../types/domain';

export const buildLogEntry = (level: LogLevel, message: string, data?: unknown): LogEntry => {
    return {
        timestamp: new Date().toISOString(),
        level,
        message,
        data,
    };
};

export const emitConsoleLog = (entry: LogEntry): void => {
    const prefix = `[TwExport ${entry.timestamp.split('T')[1]?.split('.')[0] ?? ''}]`;

    if (entry.level === 'error') {
        console.error(prefix, entry.message, entry.data ?? '');
        return;
    }

    if (entry.level === 'warn') {
        console.warn(prefix, entry.message, entry.data ?? '');
        return;
    }

    if (entry.level === 'debug') {
        console.debug(prefix, entry.message, entry.data ?? '');
        return;
    }

    console.log(prefix, entry.message, entry.data ?? '');
};
