import { bootstrapLegacyContentScript } from '@/content/bootstrap';

export const bootstrapContentScript = async (): Promise<void> => {
    await bootstrapLegacyContentScript();
};
