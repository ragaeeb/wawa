export const isXGrokPage = (pathname: string) => pathname === '/i/grok' || pathname.startsWith('/i/grok/');

export const readXGrokConversationIdFromSearch = (search: string) => {
    const conversationId = new URLSearchParams(search).get('conversation');
    if (!conversationId) {
        return null;
    }

    const trimmed = conversationId.trim();
    return trimmed.length > 0 ? trimmed : null;
};

export const shouldShowXGrokExportButton = (pathname: string, search: string) =>
    isXGrokPage(pathname) && readXGrokConversationIdFromSearch(search) !== null;
