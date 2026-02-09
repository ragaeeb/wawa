import type { RuntimeMessage, RuntimeResponseFor } from "../../types/messages";

export async function sendRuntimeMessage<T extends RuntimeMessage>(
  message: T,
): Promise<RuntimeResponseFor<T>> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponseFor<T>>;
}
