import {
    createMainButtonContainer,
    hasBlockingOverlayControls,
    renderCooldownPanel,
    updateCooldownTimerDisplay,
    updateMainButtonState,
} from '@/content/runtime-ui';

type CreateRuntimeButtonControllerInput = {
    onExportToggle: () => void;
    onResume: () => void;
    onCancelExport: () => void;
    isExporting: () => boolean;
    isPendingDone: () => boolean;
    logInfo: (message: string, data?: unknown) => void;
};

type RuntimeWindow = Window & typeof globalThis & { wawaSkipCooldown?: boolean };

export type RuntimeButtonController = {
    getContainer: () => HTMLDivElement | null;
    createButton: () => void;
    updateButton: (text: string, isError?: boolean) => void;
    resetButton: () => void;
    removeButton: () => void;
    showCooldownUI: (duration: number) => void;
    updateCooldownTimer: (milliseconds: number) => void;
    removeCooldownUI: () => void;
};

/**
 * Creates a focused controller for export/resume button lifecycle and cooldown panel UI.
 */
export const createRuntimeButtonController = (input: CreateRuntimeButtonControllerInput) => {
    let exportButton: HTMLDivElement | null = null;

    const createButton = () => {
        if (exportButton) {
            return;
        }

        exportButton = createMainButtonContainer({
            onExportToggle: input.onExportToggle,
            onResume: input.onResume,
        });
        document.body.appendChild(exportButton);
        input.logInfo('Export buttons added to page');
    };

    const updateButton = (text: string, isError = false) => {
        if (!exportButton) {
            return;
        }

        updateMainButtonState({
            container: exportButton,
            text,
            isError,
            isExporting: input.isExporting(),
            skipUpdate: input.isPendingDone() || hasBlockingOverlayControls(),
        });
    };

    const removeButton = () => {
        if (!exportButton) {
            return;
        }

        exportButton.remove();
        exportButton = null;
    };

    const resetButton = () => {
        removeButton();
        createButton();
    };

    const showCooldownUI = (duration: number) => {
        if (!exportButton) {
            return;
        }

        renderCooldownPanel({
            container: exportButton,
            duration,
            onSkip: () => {
                input.logInfo('User clicked Skip Wait');
                (window as RuntimeWindow).wawaSkipCooldown = true;
            },
            onStop: () => {
                (window as RuntimeWindow).wawaSkipCooldown = true;
                input.onCancelExport();
            },
        });
    };

    const updateCooldownTimer = (milliseconds: number) => {
        updateCooldownTimerDisplay(milliseconds);
    };

    const removeCooldownUI = () => {
        removeButton();
        createButton();
    };

    const getContainer = () => {
        return exportButton;
    };

    return {
        getContainer,
        createButton,
        updateButton,
        resetButton,
        removeButton,
        showCooldownUI,
        updateCooldownTimer,
        removeCooldownUI,
    };
};
