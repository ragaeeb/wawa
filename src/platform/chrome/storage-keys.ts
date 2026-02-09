export const STORAGE_KEYS = {
  SEARCH_AUTOSTART: "twexport_search_autostart",
  RESUME_PAYLOAD_FALLBACK: "twexport_resume_payload",
} as const;

export const RESUME_DB = {
  NAME: "twexport_resume_db",
  VERSION: 1,
  STORE: "resume_payloads",
  ACTIVE_KEY: "active",
} as const;
