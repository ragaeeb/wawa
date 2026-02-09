import { renderLooksDonePanel, renderRouteChangePanel } from '@/content/runtime-ui';

type ShowLooksDonePanelInput = {
    container: HTMLDivElement | null;
    batchCount: number;
    onDownload: () => void;
    onContinue: () => void;
    onResumeLink: () => void;
    onCancel: () => void;
    logInfo: (message: string, data?: unknown) => void;
};

type ShowRouteChangePanelInput = {
    container: HTMLDivElement | null;
    batchCount: number;
    onGoBack: () => void;
    onSaveProgress: () => void;
    onResumeLink: () => void;
    onCancel: () => void;
    logWarn: (message: string, data?: unknown) => void;
};

export const showLooksDonePanel = (input: ShowLooksDonePanelInput) => {
    if (!input.container) {
        return;
    }

    input.logInfo("Showing 'Looks Done' UI...");
    renderLooksDonePanel({
        container: input.container,
        batchCount: input.batchCount,
        onDownload: input.onDownload,
        onContinue: input.onContinue,
        onResumeLink: input.onResumeLink,
        onCancel: input.onCancel,
    });
};

export const showRouteChangePanel = (input: ShowRouteChangePanelInput) => {
    if (!input.container) {
        return;
    }

    input.logWarn('Showing route change warning UI...');
    renderRouteChangePanel({
        container: input.container,
        batchCount: input.batchCount,
        onGoBack: input.onGoBack,
        onSaveProgress: input.onSaveProgress,
        onResumeLink: input.onResumeLink,
        onCancel: input.onCancel,
    });
};
