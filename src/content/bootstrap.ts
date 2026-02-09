let bootstrapped = false;

export const bootstrapContentRuntime = async (): Promise<void> => {
    if (bootstrapped) {
        return;
    }
    bootstrapped = true;
    await import('@/content/runtime');
};
