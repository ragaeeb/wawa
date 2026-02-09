type GraphqlEndpoint = {
    id: string;
    path: string;
};

type RuntimeLoggers = {
    logInfo: (message: string, data?: unknown) => void;
    logDebug: (message: string, data?: unknown) => void;
    logError: (message: string, data?: unknown) => void;
};

type GraphqlUrlInput = {
    host: string;
    endpoint: GraphqlEndpoint;
    variables: Record<string, unknown>;
    features: Record<string, unknown>;
    fieldToggles?: Record<string, unknown> | null;
    fieldTogglesParam?: string;
};

type ResolveUserInput = {
    host: string;
    csrfToken: string;
    username: string;
    bearerToken: string;
    endpoint: GraphqlEndpoint;
    features: Record<string, unknown>;
    fieldToggles: Record<string, unknown>;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    loggers: RuntimeLoggers;
};

export const getCsrfTokenFromCookieString = (cookieString: string) => {
    const match = cookieString.match(/(?:^|;\s*)ct0=([^;]+)/);
    return match?.[1] ?? null;
};

export const buildGraphqlUrl = ({
    host,
    endpoint,
    variables,
    features,
    fieldToggles,
    fieldTogglesParam = 'field_toggles',
}: GraphqlUrlInput) => {
    const base = `https://${host}/i/api/graphql/${endpoint.id}/${endpoint.path}`;
    const params = new URLSearchParams();
    params.set('variables', JSON.stringify(variables));
    params.set('features', JSON.stringify(features));
    if (fieldToggles) {
        params.set(fieldTogglesParam, JSON.stringify(fieldToggles));
    }

    return `${base}?${params.toString()}`;
};

const fetchJsonWithCredentials = async (input: {
    url: string;
    headers: HeadersInit;
    signal: AbortSignal | null;
    fetchImpl?: typeof fetch;
    loggers: RuntimeLoggers;
}) => {
    const fetcher = input.fetchImpl ?? fetch;
    input.loggers.logDebug('Fetching', { url: `${input.url.slice(0, 100)}...` });

    const requestInit: RequestInit = {
        headers: input.headers,
        credentials: 'include',
    };
    if (input.signal) {
        requestInit.signal = input.signal;
    }

    const response = await fetcher(input.url, requestInit);

    input.loggers.logDebug('Fetch response', { status: response.status, ok: response.ok });
    return response;
};

export const resolveUserByScreenName = async ({
    host,
    csrfToken,
    username,
    bearerToken,
    endpoint,
    features,
    fieldToggles,
    signal,
    fetchImpl,
    loggers,
}: ResolveUserInput) => {
    loggers.logInfo(`Looking up user: @${username}`);

    const url = buildGraphqlUrl({
        host,
        endpoint,
        variables: {
            screen_name: username,
            withSafetyModeUserFields: true,
        },
        features,
        fieldToggles,
        fieldTogglesParam: 'field_toggles',
    });

    const response = await fetchJsonWithCredentials({
        url,
        headers: {
            authorization: bearerToken,
            'x-csrf-token': csrfToken,
        },
        signal: signal ?? null,
        loggers,
        ...(fetchImpl ? { fetchImpl } : {}),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        loggers.logError(`User lookup failed (${response.status})`, { body: body.slice(0, 500) });
        throw new Error(`User lookup failed (${response.status})`);
    }

    const data = (await response.json()) as {
        data?: {
            user?: {
                result?: {
                    __typename?: string;
                    rest_id?: string;
                    legacy?: Record<string, unknown>;
                };
            };
        };
    };
    const result = data?.data?.user?.result;

    if (result?.__typename !== 'User') {
        loggers.logError('User not found or unavailable', { typename: result?.__typename });
        throw new Error('User not found or unavailable.');
    }

    loggers.logInfo('User resolved successfully', {
        id: result.rest_id,
        name: result.legacy?.name,
        tweets: result.legacy?.statuses_count,
    });

    return {
        id: result.rest_id ?? 'unknown',
        legacy: result.legacy ?? {},
    };
};
