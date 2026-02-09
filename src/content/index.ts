import { bootstrapLegacyContentScript } from "./bootstrap";

export async function bootstrapContentScript(): Promise<void> {
  await bootstrapLegacyContentScript();
}
