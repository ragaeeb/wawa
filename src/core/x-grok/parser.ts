import type {
    XGrokAuthor,
    XGrokConversationData,
    XGrokMessage,
    XGrokMessageContent,
    XGrokMessageNode,
    XGrokThought,
} from '@/core/x-grok/types';

const DEFAULT_GROK_MODEL_SLUG = 'grok-4';

const createAuthor = (senderType: string): XGrokAuthor => ({
    role: senderType === 'User' ? 'user' : 'assistant',
    name: senderType === 'User' ? 'User' : 'Grok',
    metadata: {},
});

const extractThinkingContent = (chatItem: Record<string, unknown>) => {
    const headers = chatItem.deepsearch_headers;
    if (!Array.isArray(headers)) {
        return undefined;
    }

    const thoughts: XGrokThought[] = headers.flatMap((header) => {
        const headerRecord = header && typeof header === 'object' ? (header as Record<string, unknown>) : null;
        const steps = Array.isArray(headerRecord?.steps) ? headerRecord.steps : [];
        return steps.flatMap((step) => {
            const stepRecord = step && typeof step === 'object' ? (step as Record<string, unknown>) : null;
            const content = typeof stepRecord?.final_message === 'string' ? stepRecord.final_message : null;
            if (!content) {
                return [];
            }
            return [
                {
                    summary:
                        typeof headerRecord?.header === 'string' && headerRecord.header.trim().length > 0
                            ? headerRecord.header
                            : 'Reasoning',
                    content,
                    chunks: [],
                    finished: true,
                } satisfies XGrokThought,
            ];
        });
    });

    return thoughts.length > 0 ? thoughts : undefined;
};

const extractModelSlug = (item: Record<string, unknown>) => {
    const metadata =
        item.metadata && typeof item.metadata === 'object' ? (item.metadata as Record<string, unknown>) : null;
    const candidates = [item.model, item.model_slug, item.modelSlug, item.model_name, metadata?.model];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate.trim();
        }
    }
    return null;
};

const parseConversationIdFromUrl = (url: string) => {
    try {
        const variables = new URL(url, 'https://x.com').searchParams.get('variables');
        if (!variables) {
            return null;
        }
        const parsed = JSON.parse(variables) as { restId?: unknown };
        return typeof parsed.restId === 'string' && parsed.restId.trim().length > 0 ? parsed.restId : null;
    } catch {
        return null;
    }
};

const sanitizeFilename = (filename: string) =>
    filename
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[/\\:*?"<>|]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '') || 'untitled';

const generateTimestamp = (unixTime?: number) => {
    const date = typeof unixTime === 'number' ? new Date(unixTime * 1000) : new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
};

type ParsedItem = {
    chatItemId: string;
    createdAtMs: number | null;
    senderType: string;
    messageText: string;
    modelSlug: string | null;
    message: XGrokMessage;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

type ConversationBuildState = {
    conversationId: string;
    title: string;
    modelSlug: string;
    createTime: number;
    updateTime: number;
    previousNodeId: string;
    mapping: Record<string, XGrokMessageNode>;
};

const getConversationItems = (payload: unknown) => {
    const data = asRecord(payload);
    const innerData = asRecord(data?.data);
    const conversationItems =
        innerData?.grok_conversation_items_by_rest_id &&
        typeof innerData.grok_conversation_items_by_rest_id === 'object'
            ? (innerData.grok_conversation_items_by_rest_id as Record<string, unknown>)
            : null;
    return Array.isArray(conversationItems?.items) ? conversationItems.items : null;
};

const createConversationState = (options: { conversationId?: string | null; cachedTitle?: string | null }) => {
    const rootId = 'grok-root';
    const mapping: Record<string, XGrokMessageNode> = {
        [rootId]: {
            id: rootId,
            message: null,
            parent: null,
            children: [],
        },
    };

    return {
        conversationId: options.conversationId?.trim() || '',
        title: options.cachedTitle?.trim() || 'Grok Conversation',
        modelSlug: DEFAULT_GROK_MODEL_SLUG,
        createTime: Date.now() / 1000,
        updateTime: Date.now() / 1000,
        previousNodeId: rootId,
        mapping,
    } satisfies ConversationBuildState;
};

const maybeUpdateConversationTitle = (
    state: ConversationBuildState,
    parsedItem: ParsedItem,
    options: { cachedTitle?: string | null },
) => {
    if (options.cachedTitle || parsedItem.senderType !== 'User') {
        return;
    }

    const firstLine = parsedItem.messageText.split('\n')[0]?.trim() ?? '';
    if (firstLine.length > 0 && firstLine.length < 100) {
        state.title = firstLine;
    }
};

const applyParsedItem = (
    state: ConversationBuildState,
    parsedItem: ParsedItem,
    index: number,
    options: { cachedTitle?: string | null },
) => {
    if (index === 0 && !state.conversationId) {
        state.conversationId = parsedItem.chatItemId;
    }

    if (index === 0) {
        maybeUpdateConversationTitle(state, parsedItem, options);
    }

    if (parsedItem.createdAtMs) {
        const timestamp = parsedItem.createdAtMs / 1000;
        if (index === 0) {
            state.createTime = timestamp;
        }
        state.updateTime = Math.max(state.updateTime, timestamp);
    }

    if (parsedItem.modelSlug) {
        state.modelSlug = parsedItem.modelSlug;
    }

    state.mapping[parsedItem.chatItemId] = {
        id: parsedItem.chatItemId,
        message: parsedItem.message,
        parent: state.previousNodeId,
        children: [],
    };
    state.mapping[state.previousNodeId]?.children.push(parsedItem.chatItemId);
    state.previousNodeId = parsedItem.chatItemId;
};

const parseItem = (item: unknown): ParsedItem | null => {
    const record = asRecord(item);
    if (!record) {
        return null;
    }

    const chatItemId = typeof record.chat_item_id === 'string' ? record.chat_item_id : null;
    if (!chatItemId) {
        return null;
    }

    const senderType = typeof record.sender_type === 'string' ? record.sender_type : 'Agent';
    const messageText = typeof record.message === 'string' ? record.message : '';
    const createdAtMs = typeof record.created_at_ms === 'number' ? record.created_at_ms : null;
    const isPartial = record.is_partial === true;
    const thoughts = extractThinkingContent(record);
    const modelSlug = extractModelSlug(record);

    const content: XGrokMessageContent = {
        content_type: thoughts ? 'thoughts' : 'text',
        parts: [messageText],
    };
    if (thoughts) {
        content.thoughts = thoughts;
    }

    return {
        chatItemId,
        createdAtMs,
        senderType,
        messageText,
        modelSlug,
        message: {
            id: chatItemId,
            author: createAuthor(senderType),
            create_time: createdAtMs ? createdAtMs / 1000 : null,
            update_time: null,
            content,
            status: isPartial ? 'in_progress' : 'finished_successfully',
            end_turn: !isPartial,
            weight: 1,
            metadata: {
                grok_mode: typeof record.grok_mode === 'string' ? record.grok_mode : 'Normal',
                sender_type: senderType,
                is_partial: isPartial,
                model: modelSlug ?? null,
                thinking_trace: typeof record.thinking_trace === 'string' ? record.thinking_trace : '',
                ui_layout:
                    record.ui_layout && typeof record.ui_layout === 'object'
                        ? (record.ui_layout as Record<string, unknown>)
                        : {},
            },
            recipient: 'all',
            channel: null,
        },
    };
};

export const parseXGrokConversation = (
    payload: unknown,
    options: {
        conversationId?: string | null;
        cachedTitle?: string | null;
    } = {},
): XGrokConversationData | null => {
    const items = getConversationItems(payload);
    if (!items || items.length === 0) {
        return null;
    }

    const state = createConversationState(options);
    let parsedCount = 0;

    for (const item of items) {
        const parsedItem = parseItem(item);
        if (!parsedItem) {
            continue;
        }
        applyParsedItem(state, parsedItem, parsedCount, options);
        parsedCount += 1;
    }

    if (parsedCount === 0) {
        return null;
    }

    return {
        title: state.title,
        create_time: state.createTime,
        update_time: state.updateTime,
        mapping: state.mapping,
        conversation_id: state.conversationId,
        current_node: state.previousNodeId,
        moderation_results: [],
        plugin_ids: null,
        gizmo_id: null,
        gizmo_type: null,
        is_archived: false,
        default_model_slug: state.modelSlug,
        safe_urls: [],
        blocked_urls: [],
    } satisfies XGrokConversationData;
};

export const resolveXGrokConversationIdFromUrl = (url: string) => parseConversationIdFromUrl(url);

export const formatXGrokFilename = (conversation: XGrokConversationData) => {
    const title = conversation.title.trim();
    const fallbackTitle =
        title.length > 0 ? title : `grok_conversation_${conversation.conversation_id.slice(0, 8) || 'unknown'}`;
    return `${sanitizeFilename(fallbackTitle).slice(0, 80)}_${generateTimestamp(conversation.update_time)}`;
};
