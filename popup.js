// TwExport Minimal - Popup Script
// Log viewer for the extension.

const els = {
  status: document.getElementById("status"),
  log: document.getElementById("log"),
  refreshLogs: document.getElementById("refreshLogs"),
  clearLogs: document.getElementById("clearLogs")
};

function formatLogEntry(entry) {
  const time = entry.timestamp.split("T")[1].split(".")[0];
  const level = entry.level.toUpperCase().padEnd(5);
  let line = `[${time}] ${level} ${entry.message}`;
  if (entry.data) {
    line += ` ${JSON.stringify(entry.data)}`;
  }
  return line;
}

async function loadLogs() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "getLogs" });
    const logs = response.logs || [];

    if (logs.length === 0) {
      els.log.textContent = "No logs yet. Navigate to a Twitter profile and click 'Save Tweets'.";
    } else {
      els.log.textContent = logs.map(formatLogEntry).join("\n");
      els.log.scrollTop = els.log.scrollHeight;
    }
  } catch (err) {
    console.error("Failed to load logs:", err);
    els.log.textContent = "Failed to load logs.";
  }
}

async function clearLogs() {
  try {
    await chrome.runtime.sendMessage({ type: "clearLogs" });
    els.log.textContent = "Logs cleared.";
  } catch (err) {
    console.error("Failed to clear logs:", err);
  }
}

// Event listeners
els.refreshLogs.addEventListener("click", loadLogs);
els.clearLogs.addEventListener("click", clearLogs);

// Initialize
loadLogs();

// Optional: Poll for new logs? (Maybe better to have background send log updates)
// For now, simple manual refresh is fine as per original code.
