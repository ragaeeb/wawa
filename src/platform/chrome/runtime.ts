import type { RuntimeMessage, RuntimeResponseFor } from '@/types/messages';

export const sendRuntimeMessage = async <T extends RuntimeMessage>(message: T): Promise<RuntimeResponseFor<T>> => {
    return chrome.runtime.sendMessage(message) as Promise<RuntimeResponseFor<T>>;
};
