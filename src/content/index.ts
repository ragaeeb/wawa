import { bootstrapContentRuntime } from '@/content/bootstrap';

export const bootstrapContentScript = async (): Promise<void> => {
    await bootstrapContentRuntime();
};
