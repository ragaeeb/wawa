let bootstrapped = false;

export const bootstrapLegacyContentScript = async (): Promise<void> => {
    if (bootstrapped) {
        return;
    }
    bootstrapped = true;
    await import('../legacy/content-script');
};
