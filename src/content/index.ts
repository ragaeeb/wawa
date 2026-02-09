import { bootstrapLegacyContentScript } from './bootstrap';

export const bootstrapContentScript = async (): Promise<void> => {
    await bootstrapLegacyContentScript();
};
