let bootstrapped = false;

export async function bootstrapLegacyContentScript(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  await import("../legacy/content-script");
}
