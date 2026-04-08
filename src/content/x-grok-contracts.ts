import type { XGrokBulkExportResult } from '@/core/x-grok/types';

export const WAWA_X_GROK_BULK_EXPORT_MESSAGE = 'WAWA_X_GROK_BULK_EXPORT';
export const WAWA_X_GROK_CLEAR_ALL_MESSAGE = 'WAWA_X_GROK_CLEAR_ALL';
export const DEFAULT_X_GROK_BULK_EXPORT_LIMIT = 100;
export const X_GROK_BULK_EXPORT_LIMIT_STORAGE_KEY = 'wawa_x_grok_bulk_export_limit';

export type XGrokBulkExportMessage = {
    type: typeof WAWA_X_GROK_BULK_EXPORT_MESSAGE;
    limit?: number;
};

export type XGrokClearAllMessage = {
    type: typeof WAWA_X_GROK_CLEAR_ALL_MESSAGE;
};

export type XGrokBulkExportSuccessResponse = {
    ok: true;
    result: XGrokBulkExportResult;
};

export type XGrokBulkExportErrorResponse = {
    ok: false;
    error: string;
};

export type XGrokBulkExportResponse = XGrokBulkExportSuccessResponse | XGrokBulkExportErrorResponse;

export type XGrokClearAllSuccessResponse = {
    ok: true;
};

export type XGrokClearAllErrorResponse = {
    ok: false;
    error: string;
};

export type XGrokClearAllResponse = XGrokClearAllSuccessResponse | XGrokClearAllErrorResponse;

export const normalizeXGrokBulkExportLimit = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_X_GROK_BULK_EXPORT_LIMIT;
    }

    if (value <= 0) {
        return 0;
    }

    return Math.max(1, Math.floor(value));
};

export const isXGrokBulkExportMessage = (value: unknown): value is XGrokBulkExportMessage => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const typed = value as Partial<XGrokBulkExportMessage>;
    return (
        typed.type === WAWA_X_GROK_BULK_EXPORT_MESSAGE &&
        (typed.limit === undefined ||
            (typeof typed.limit === 'number' && Number.isInteger(typed.limit) && typed.limit >= 0))
    );
};

export const isXGrokClearAllMessage = (value: unknown): value is XGrokClearAllMessage => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const typed = value as Partial<XGrokClearAllMessage>;
    return typed.type === WAWA_X_GROK_CLEAR_ALL_MESSAGE;
};
