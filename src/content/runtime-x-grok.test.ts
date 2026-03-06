import { describe, expect, it, mock } from 'bun:test';
import { createRuntimeState } from '@/content/runtime-state';
import { createRuntimeXGrok } from '@/content/runtime-x-grok';
import { WAWA_X_GROK_BULK_EXPORT_MESSAGE } from '@/content/x-grok-contracts';
import type { XGrokFeature } from '@/content/x-grok-feature';

const createFeature = (overrides: Partial<XGrokFeature> = {}): XGrokFeature => ({
    shouldShowButton: () => true,
    isOnGrokPage: () => true,
    observeInterceptedUrl: async () => {},
    exportCurrentConversation: async () => ({ filename: 'chat.json', conversation: {} as never }),
    handleBulkExportMessage: async () => ({ ok: true, result: {} as never }),
    getObservedContext: () => null,
    ...overrides,
});

const createInput = () => {
    const state = createRuntimeState();
    const controller = {
        createButton: mock(() => {}),
        updateButton: mock(() => {}),
        resetButton: mock(() => {}),
        removeButton: mock(() => {}),
    };
    const feature = createFeature();
    const ensureInterception = mock(async () => {});
    const removeMainButton = mock(() => {});
    const scheduleReset = mock((callback: () => void) => {
        callback();
    });

    return {
        state,
        controller,
        feature,
        ensureInterception,
        removeMainButton,
        scheduleReset,
        loggers: {
            logInfo: mock(() => {}),
            logDebug: mock(() => {}),
            logWarn: mock(() => {}),
            logError: mock(() => {}),
        },
    };
};

describe('createRuntimeXGrok', () => {
    it('should take over route UI on grok pages and start interception', async () => {
        const input = createInput();
        const runtime = createRuntimeXGrok({
            state: input.state,
            getLocationPathname: () => '/i/grok',
            getLocationSearch: () => '?conversation=1',
            getCsrfToken: () => 'csrf',
            getLanguage: () => 'en-US',
            downloadJson: mock(() => {}),
            ensureInterception: input.ensureInterception,
            removeMainButton: input.removeMainButton,
            loggers: input.loggers,
            implementations: {
                createFeature: () => input.feature,
                createButtonController: () => input.controller,
                scheduleReset: input.scheduleReset,
            },
        });

        expect(runtime.syncRouteUi()).toBe(true);
        expect(input.removeMainButton).toHaveBeenCalled();
        expect(input.controller.createButton).toHaveBeenCalled();
        expect(input.controller.resetButton).toHaveBeenCalled();
        await Promise.resolve();
        expect(input.ensureInterception).toHaveBeenCalled();
    });

    it('should ignore non-grok routes and remove the grok button', () => {
        const input = createInput();
        input.feature = createFeature({
            isOnGrokPage: () => false,
        });

        const runtime = createRuntimeXGrok({
            state: input.state,
            getLocationPathname: () => '/home',
            getLocationSearch: () => '',
            getCsrfToken: () => 'csrf',
            getLanguage: () => 'en-US',
            downloadJson: mock(() => {}),
            ensureInterception: input.ensureInterception,
            removeMainButton: input.removeMainButton,
            loggers: input.loggers,
            implementations: {
                createFeature: () => input.feature,
                createButtonController: () => input.controller,
                scheduleReset: input.scheduleReset,
            },
        });

        expect(runtime.syncRouteUi()).toBe(false);
        expect(input.controller.removeButton).toHaveBeenCalled();
        expect(input.ensureInterception).not.toHaveBeenCalled();
    });

    it('should export a single chat and reset button state', async () => {
        const input = createInput();
        const runtime = createRuntimeXGrok({
            state: input.state,
            getLocationPathname: () => '/i/grok',
            getLocationSearch: () => '?conversation=1',
            getCsrfToken: () => 'csrf',
            getLanguage: () => 'en-US',
            downloadJson: mock(() => {}),
            ensureInterception: input.ensureInterception,
            removeMainButton: input.removeMainButton,
            loggers: input.loggers,
            implementations: {
                createFeature: () => input.feature,
                createButtonController: () => input.controller,
                scheduleReset: input.scheduleReset,
            },
        });

        await runtime.handleSingleExport();

        expect(input.controller.updateButton).toHaveBeenCalledWith({ text: '⏳ Exporting chat...', disabled: true });
        expect(input.controller.updateButton).toHaveBeenCalledWith({ text: '✅ Chat exported', disabled: true });
        expect(input.scheduleReset).toHaveBeenCalled();
        expect(input.state.isXGrokExporting).toBe(false);
    });

    it('should surface single-export failures without leaving the tab locked', async () => {
        const input = createInput();
        input.feature = createFeature({
            exportCurrentConversation: async () => {
                throw new Error('boom');
            },
        });

        const runtime = createRuntimeXGrok({
            state: input.state,
            getLocationPathname: () => '/i/grok',
            getLocationSearch: () => '?conversation=1',
            getCsrfToken: () => 'csrf',
            getLanguage: () => 'en-US',
            downloadJson: mock(() => {}),
            ensureInterception: input.ensureInterception,
            removeMainButton: input.removeMainButton,
            loggers: input.loggers,
            implementations: {
                createFeature: () => input.feature,
                createButtonController: () => input.controller,
                scheduleReset: input.scheduleReset,
            },
        });

        await runtime.handleSingleExport();

        expect(input.controller.updateButton).toHaveBeenCalledWith({
            text: '❌ Export failed',
            disabled: false,
            isError: true,
        });
        expect(input.loggers.logError).toHaveBeenCalledWith('X-Grok conversation export failed', { error: 'boom' });
        expect(input.state.isXGrokExporting).toBe(false);
    });

    it('should handle bulk export runtime messages and release the busy flag', async () => {
        const input = createInput();
        input.feature = createFeature({
            handleBulkExportMessage: async () => ({ ok: true, result: { exported: 2 } as never }),
        });
        const runtime = createRuntimeXGrok({
            state: input.state,
            getLocationPathname: () => '/i/grok',
            getLocationSearch: () => '',
            getCsrfToken: () => 'csrf',
            getLanguage: () => 'en-US',
            downloadJson: mock(() => {}),
            ensureInterception: input.ensureInterception,
            removeMainButton: input.removeMainButton,
            loggers: input.loggers,
            implementations: {
                createFeature: () => input.feature,
                createButtonController: () => input.controller,
                scheduleReset: input.scheduleReset,
            },
        });
        const sendResponse = mock(() => {});

        const handled = runtime.handleRuntimeMessage(
            {
                type: WAWA_X_GROK_BULK_EXPORT_MESSAGE,
                limit: 5,
            },
            sendResponse,
        );

        expect(handled).toBe(true);
        await Promise.resolve();
        await Promise.resolve();
        expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { exported: 2 } });
        expect(input.state.isXGrokBulkExporting).toBe(false);
    });

    it('should surface bulk export failures and release the busy flag', async () => {
        const input = createInput();
        input.feature = createFeature({
            handleBulkExportMessage: async () => {
                throw new Error('bulk boom');
            },
        });
        const runtime = createRuntimeXGrok({
            state: input.state,
            getLocationPathname: () => '/i/grok',
            getLocationSearch: () => '',
            getCsrfToken: () => 'csrf',
            getLanguage: () => 'en-US',
            downloadJson: mock(() => {}),
            ensureInterception: input.ensureInterception,
            removeMainButton: input.removeMainButton,
            loggers: input.loggers,
            implementations: {
                createFeature: () => input.feature,
                createButtonController: () => input.controller,
                scheduleReset: input.scheduleReset,
            },
        });
        const sendResponse = mock(() => {});

        const handled = runtime.handleRuntimeMessage(
            {
                type: WAWA_X_GROK_BULK_EXPORT_MESSAGE,
                limit: 5,
            },
            sendResponse,
        );

        expect(handled).toBe(true);
        await Promise.resolve();
        await Promise.resolve();
        expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'bulk boom' });
        expect(input.loggers.logError).toHaveBeenCalledWith('X-Grok bulk export failed', { error: 'bulk boom' });
        expect(input.state.isXGrokBulkExporting).toBe(false);
    });

    it('should reject bulk export requests while another export is running', () => {
        const input = createInput();
        input.state.isExporting = true;
        const runtime = createRuntimeXGrok({
            state: input.state,
            getLocationPathname: () => '/i/grok',
            getLocationSearch: () => '',
            getCsrfToken: () => 'csrf',
            getLanguage: () => 'en-US',
            downloadJson: mock(() => {}),
            ensureInterception: input.ensureInterception,
            removeMainButton: input.removeMainButton,
            loggers: input.loggers,
            implementations: {
                createFeature: () => input.feature,
                createButtonController: () => input.controller,
                scheduleReset: input.scheduleReset,
            },
        });
        const sendResponse = mock(() => {});

        const handled = runtime.handleRuntimeMessage(
            {
                type: WAWA_X_GROK_BULK_EXPORT_MESSAGE,
            },
            sendResponse,
        );

        expect(handled).toBe(false);
        expect(sendResponse).toHaveBeenCalledWith({
            ok: false,
            error: 'Another export is already running in this tab.',
        });
    });
});
