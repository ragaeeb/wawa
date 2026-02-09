import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";

const rootDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(rootDir, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  version: string;
};

export default defineConfig({
  manifestVersion: 3,
  srcDir: ".",
  outDir: ".output",
  modules: [],
  manifest: {
    name: "TwExport Minimal",
    description: "Minimal local export of X/Twitter posts without telemetry.",
    version: packageJson.version,
    permissions: ["cookies", "storage", "unlimitedStorage"],
    icons: {
      "16": "icons/16.png",
      "32": "icons/32.png",
      "48": "icons/48.png",
      "96": "icons/96.png",
      "128": "icons/128.png",
    },
    host_permissions: ["*://*.x.com/*", "*://*.twitter.com/*"],
    action: {
      default_title: "TwExport Minimal",
      default_icon: {
        "16": "icons/16.png",
        "32": "icons/32.png",
      },
    },
    web_accessible_resources: [
      {
        resources: ["/interceptor.js"],
        matches: ["*://*.x.com/*", "*://*.twitter.com/*"],
      },
    ],
  },
});
