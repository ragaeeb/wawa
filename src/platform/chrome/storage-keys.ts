export const STORAGE_KEYS = {
    SEARCH_AUTOSTART: 'wawa_search_autostart',
    RESUME_PAYLOAD_FALLBACK: 'wawa_resume_payload',
} as const;

export const RESUME_DB = {
    NAME: 'wawa_resume_db',
    VERSION: 1,
    STORE: 'resume_payloads',
    ACTIVE_KEY: 'active',
} as const;
