type LogLevel = 'info' | 'debug' | 'warn' | 'error';

export type RuntimeLogEntry = {
    timestamp: string;
    level: LogLevel;
    message: string;
    data: unknown;
};

type CreateRuntimeLoggerInput = {
    prefixLabel: string;
    maxEntries?: number;
    onEntry?: (entry: RuntimeLogEntry) => void;
};

const writeToConsole = (prefix: string, level: LogLevel, message: string, data: unknown) => {
    if (level === 'error') {
        console.error(prefix, message, data ?? '');
        return;
    }

    if (level === 'warn') {
        console.warn(prefix, message, data ?? '');
        return;
    }

    if (level === 'debug') {
        console.debug(prefix, message, data ?? '');
        return;
    }

    console.log(prefix, message, data ?? '');
};

export const createRuntimeLogger = ({ prefixLabel, maxEntries = 500, onEntry }: CreateRuntimeLoggerInput) => {
    let entries: RuntimeLogEntry[] = [];

    const log = (level: LogLevel, message: string, data: unknown = null) => {
        const timestamp = new Date().toISOString();
        const entry: RuntimeLogEntry = {
            timestamp,
            level,
            message,
            data,
        };

        entries.push(entry);
        if (entries.length > maxEntries) {
            entries = entries.slice(-maxEntries);
        }

        const prefix = `[${prefixLabel} ${timestamp.split('T')[1]?.split('.')[0] || timestamp}]`;
        writeToConsole(prefix, level, message, data);
        onEntry?.(entry);
    };

    return {
        log,
        logInfo: (message: string, data?: unknown) => {
            log('info', message, data);
        },
        logDebug: (message: string, data?: unknown) => {
            log('debug', message, data);
        },
        logWarn: (message: string, data?: unknown) => {
            log('warn', message, data);
        },
        logError: (message: string, data?: unknown) => {
            log('error', message, data);
        },
        getEntries: () => entries.slice(),
    };
};
