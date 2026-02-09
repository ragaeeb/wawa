const RESERVED_SEGMENTS = [
    'home',
    'explore',
    'search',
    'notifications',
    'messages',
    'bookmarks',
    'lists',
    'settings',
    'compose',
    'i',
    'intent',
    'login',
    'logout',
    'signup',
    'tos',
    'privacy',
    'about',
    'help',
    'jobs',
    'download',
];

const extractUsernameFromSearchQuery = (search: string) => {
    const params = new URLSearchParams(search);
    const query = params.get('q');
    if (!query) {
        return null;
    }

    const match = query.match(/from:([A-Za-z0-9_]+)/i);
    if (!match) {
        return null;
    }

    const username = match[1];
    if (!username) {
        return null;
    }

    return username.toLowerCase();
};

export const extractUsernameFromLocation = (pathname: string, search: string) => {
    if (pathname === '/search') {
        return extractUsernameFromSearchQuery(search);
    }

    const match = pathname.match(/^\/([A-Za-z0-9_]{1,15})(?:\/|$)/);
    if (!match) {
        return null;
    }

    const username = match[1];
    if (!username) {
        return null;
    }

    if (RESERVED_SEGMENTS.includes(username.toLowerCase())) {
        return null;
    }

    return username;
};
