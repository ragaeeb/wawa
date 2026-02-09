let bootstrapped = false;

export const bootstrapContentRuntime = async () => {
    if (bootstrapped) {
        return;
    }
    bootstrapped = true;
    await import('@/content/runtime');
};
