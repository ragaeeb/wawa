let bootstrapped = false;

const bootstrapContentRuntime = async () => {
    if (bootstrapped) {
        return;
    }
    bootstrapped = true;
    await import('@/content/runtime');
    const { bootstrapVideoDownloader } = await import('@/content/video-downloader');
    bootstrapVideoDownloader();
};

export const bootstrapContentScript = async () => {
    await bootstrapContentRuntime();
};
