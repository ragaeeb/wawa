import { createSearchUrl, resolveSearchQueryForProfile } from '@/content/export-flow';
import { createSearchAutoStartContext } from '@/content/resume-controller';

type ExportUser = {
    id: string;
    name?: string;
    legacy?: Record<string, any>;
};

type RedirectProfileExportInput = {
    username: string;
    getCsrfToken: () => string | null;
    getUserByScreenName: (csrfToken: string, username: string) => Promise<ExportUser>;
    updateButton: (text: string, isError?: boolean) => void;
    saveAutoStartContext: (context: Record<string, unknown>) => Promise<void>;
    navigateTo: (url: string) => void;
    logInfo: (message: string, data?: unknown) => void;
    logWarn: (message: string, data?: unknown) => void;
};

type EnsureResumeStateForSearchInput = {
    searchUser: string;
    params: URLSearchParams;
    autoStartCtx: Record<string, unknown> | null;
    restoreResumeState: (targetUsername: string) => Promise<boolean>;
    getPriorTweetsCount: () => number;
    updateButton: (text: string, isError?: boolean) => void;
    resetButton: () => void;
    alertUser: (message: string) => void;
    logInfo: (message: string, data?: unknown) => void;
    logError: (message: string, data?: unknown) => void;
};

export const redirectProfileExportToSearch = async (input: RedirectProfileExportInput) => {
    input.logInfo('Redirecting to Search view for cleaner export...');
    input.updateButton('🔍 Preparing search...');

    const query = await resolveSearchQueryForProfile({
        username: input.username,
        getCsrfToken: input.getCsrfToken,
        getUserByScreenName: input.getUserByScreenName,
        loggers: { logInfo: input.logInfo, logWarn: input.logWarn },
    });
    await input.saveAutoStartContext(createSearchAutoStartContext(input.username));

    input.updateButton('🔄 Redirecting...');
    input.navigateTo(createSearchUrl(query));
};

export const ensureResumeStateForSearch = async (input: EnsureResumeStateForSearchInput) => {
    const isResumeRequest = input.params.get('wawa_resume') === '1' || Boolean(input.autoStartCtx?.resumeMode);
    if (!isResumeRequest) {
        return true;
    }

    const restoredResume = await input.restoreResumeState(input.searchUser);
    if (restoredResume) {
        input.logInfo(`Resume mode enabled for @${input.searchUser} (${input.getPriorTweetsCount()} prior tweets)`);
        return true;
    }

    input.logError('Resume requested but no cached resume payload was found.');
    input.updateButton('❌ Resume data missing', true);
    input.alertUser(
        "Resume state could not be restored. Please click 'Resume' again and reload your previous export file before continuing.",
    );
    setTimeout(input.resetButton, 5000);
    return false;
};
