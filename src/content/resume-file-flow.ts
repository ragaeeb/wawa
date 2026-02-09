import { processResumeFileUpload } from '@/content/resume-controller';

type AnyRecord = Record<string, any>;

type StartResumeFromFileInput = {
    getFallbackUsername: () => string | null;
    updateButton: (text: string, isError?: boolean) => void;
    setResumeState: (tweets: AnyRecord[], sourceMeta: AnyRecord | null) => void;
    resetResumeFlowState: () => void;
    persistResumeState: (username: string, tweets: AnyRecord[], sourceMeta: AnyRecord | null) => Promise<boolean>;
    saveAutoStartContext: (context: Record<string, unknown>) => Promise<void>;
    navigateTo: (url: string) => void;
    logInfo: (message: string, data?: unknown) => void;
    logError: (message: string, data?: unknown) => void;
    alertUser: (message: string) => void;
};

export const startResumeFromFile = (input: StartResumeFromFileInput) => {
    input.logInfo('Resume from File triggered');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';

    fileInput.onchange = async (event) => {
        const target = event.target as HTMLInputElement | null;
        const file = target?.files?.[0];
        if (!file) {
            fileInput.remove();
            return;
        }

        try {
            await processResumeFileUpload({
                file,
                fallbackUsername: input.getFallbackUsername(),
                updateButton: input.updateButton,
                setResumeState: input.setResumeState,
                resetResumeFlowState: input.resetResumeFlowState,
                persistResumeState: input.persistResumeState,
                saveAutoStartContext: input.saveAutoStartContext,
                logInfo: input.logInfo,
                navigateTo: input.navigateTo,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            input.logError(`Failed to parse resume file: ${message}`);
            input.alertUser(`❌ Failed to load file:\n${message}`);
            input.resetResumeFlowState();
        }

        fileInput.remove();
    };

    document.body.appendChild(fileInput);
    fileInput.click();
};
