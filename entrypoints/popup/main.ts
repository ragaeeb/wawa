import { sendRuntimeMessage } from "../../src/platform/chrome/runtime";
import type { LogEntry } from "../../src/types/domain";
import "./style.css";

const elements = {
  status: document.getElementById("status") as HTMLDivElement,
  log: document.getElementById("log") as HTMLPreElement,
  refreshLogs: document.getElementById("refreshLogs") as HTMLButtonElement,
  clearLogs: document.getElementById("clearLogs") as HTMLButtonElement,
};

function formatLogEntry(entry: LogEntry): string {
  const time = entry.timestamp.split("T")[1]?.split(".")[0] ?? entry.timestamp;
  const level = entry.level.toUpperCase().padEnd(5);
  let line = `[${time}] ${level} ${entry.message}`;

  if (entry.data !== undefined) {
    line += ` ${JSON.stringify(entry.data)}`;
  }

  return line;
}

async function loadLogs(): Promise<void> {
  try {
    const response = await sendRuntimeMessage({ type: "getLogs" });
    const logs = response.logs ?? [];

    if (logs.length === 0) {
      elements.log.textContent =
        "No logs yet. Navigate to a Twitter profile and click 'Export Tweets'.";
      return;
    }

    elements.log.textContent = logs.map(formatLogEntry).join("\n");
    elements.log.scrollTop = elements.log.scrollHeight;
  } catch (error) {
    elements.log.textContent = `Failed to load logs: ${String(error)}`;
  }
}

async function clearLogs(): Promise<void> {
  try {
    await sendRuntimeMessage({ type: "clearLogs" });
    elements.log.textContent = "Logs cleared.";
  } catch (error) {
    elements.log.textContent = `Failed to clear logs: ${String(error)}`;
  }
}

elements.refreshLogs.addEventListener("click", () => {
  void loadLogs();
});

elements.clearLogs.addEventListener("click", () => {
  void clearLogs();
});

void loadLogs();
