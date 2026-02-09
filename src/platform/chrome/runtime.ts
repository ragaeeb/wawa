import type { RuntimeMessage, RuntimeResponseFor } from '@/types/messages';

/**
 * Typed wrapper around `chrome.runtime.sendMessage`.
 */
export const sendRuntimeMessage = async <T extends RuntimeMessage>(message: T) => {
    return chrome.runtime.sendMessage(message) as Promise<RuntimeResponseFor<T>>;
};
