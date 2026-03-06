import type { RuntimeState } from '@/content/runtime-state';
import { createXGrokButtonController, type XGrokButtonController } from '@/content/x-grok-button-controller';
import {
    isXGrokBulkExportMessage,
    type XGrokBulkExportMessage,
    type XGrokBulkExportResponse,
} from '@/content/x-grok-contracts';
import { createXGrokFeature } from '@/content/x-grok-feature';

type RuntimeLoggers = {
    logInfo: (message: string, data?: unknown) => void;
    logDebug: (message: string, data?: unknown) => void;
    logWarn: (message: string, data?: unknown) => void;
    logError: (message: string, data?: unknown) => void;
};

type RuntimeXGrokImplementations = {
    createFeature: typeof createXGrokFeature;
    createButtonController: typeof createXGrokButtonController;
    scheduleReset: (callback: () => void, delayMs: number) => void;
};

type CreateRuntimeXGrokInput = {
    state: RuntimeState;
    getLocationPathname: () => string;
    getLocationSearch: () => string;
    getCsrfToken: () => string | null;
    getLanguage: () => string;
    downloadJson: (filename: string, payload: unknown) => void;
    ensureInterception: () => Promise<void>;
    removeMainButton: () => void;
    loggers: RuntimeLoggers;
    implementations?: Partial<RuntimeXGrokImplementations>;
};

export type RuntimeXGrok = {
    syncRouteUi: () => boolean;
    observeInterceptedUrl: (url: string) => Promise<void>;
    handleSingleExport: () => Promise<void>;
    handleRuntimeMessage: (
        message: unknown,
        sendResponse: (response: XGrokBulkExportResponse) => void,
    ) => boolean | undefined;
    dispose: () => void;
};

const defaultImplementations: RuntimeXGrokImplementations = {
    createFeature: createXGrokFeature,
    createButtonController: createXGrokButtonController,
    scheduleReset: (callback, delayMs) => {
        setTimeout(callback, delayMs);
    },
};

export const createRuntimeXGrok = (input: CreateRuntimeXGrokInput): RuntimeXGrok => {
    const implementations = {
        ...defaultImplementations,
        ...input.implementations,
    };

    const feature = implementations.createFeature({
        getLocationPathname: input.getLocationPathname,
        getLocationSearch: input.getLocationSearch,
        getCsrfToken: input.getCsrfToken,
        getLanguage: input.getLanguage,
        downloadJson: input.downloadJson,
        loggers: input.loggers,
    });

    let buttonController: XGrokButtonController | null = null;

    const resetButton = () => {
        buttonController?.resetButton();
        input.state.isXGrokExporting = false;
    };

    const handleSingleExport = async () => {
        if (input.state.isExporting || input.state.isXGrokExporting || input.state.isXGrokBulkExporting) {
            return;
        }

        input.state.isXGrokExporting = true;
        buttonController?.updateButton({ text: '⏳ Exporting chat...', disabled: true });

        try {
            await feature.exportCurrentConversation();
            buttonController?.updateButton({ text: '✅ Chat exported', disabled: true });
            input.loggers.logInfo('X-Grok conversation exported');
            implementations.scheduleReset(resetButton, 2500);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            input.loggers.logError('X-Grok conversation export failed', { error: message });
            buttonController?.updateButton({ text: '❌ Export failed', disabled: false, isError: true });
            implementations.scheduleReset(resetButton, 4000);
        }
    };

    buttonController = implementations.createButtonController({
        onExport: () => {
            void handleSingleExport();
        },
        logInfo: input.loggers.logInfo,
    });

    const syncRouteUi = () => {
        if (!feature.isOnGrokPage()) {
            buttonController?.removeButton();
            return false;
        }

        input.removeMainButton();

        if (feature.shouldShowButton()) {
            buttonController?.createButton();
            if (!input.state.isXGrokExporting) {
                buttonController?.resetButton();
            }
        } else {
            buttonController?.removeButton();
        }

        void input.ensureInterception().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            input.loggers.logWarn('Failed to start interceptor for x-grok context capture', { error: message });
        });

        return true;
    };

    const handleRuntimeMessage = (message: unknown, sendResponse: (response: XGrokBulkExportResponse) => void) => {
        if (!isXGrokBulkExportMessage(message)) {
            return undefined;
        }

        if (input.state.isExporting || input.state.isXGrokExporting || input.state.isXGrokBulkExporting) {
            sendResponse({
                ok: false,
                error: 'Another export is already running in this tab.',
            });
            return false;
        }

        input.state.isXGrokBulkExporting = true;
        input.loggers.logInfo('Received popup request for x-grok bulk export', {
            limit: (message as XGrokBulkExportMessage).limit ?? null,
        });

        feature
            .handleBulkExportMessage(message)
            .then((response) => {
                sendResponse(response);
            })
            .finally(() => {
                input.state.isXGrokBulkExporting = false;
            });

        return true;
    };

    return {
        syncRouteUi,
        observeInterceptedUrl: (url) => feature.observeInterceptedUrl(url),
        handleSingleExport,
        handleRuntimeMessage,
        dispose: () => {
            buttonController?.removeButton();
        },
    };
};
