let bootstrapped = false;

const bootstrapContentRuntime = async () => {
    if (bootstrapped) {
        return;
    }
    bootstrapped = true;
    await import('@/content/runtime');
};

export const bootstrapContentScript = async () => {
    await bootstrapContentRuntime();
};
