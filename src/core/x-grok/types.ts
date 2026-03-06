export type XGrokAuthor = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    name: string | null;
    metadata: Record<string, unknown>;
};

export type XGrokThought = {
    summary: string;
    content: string;
    chunks: string[];
    finished: boolean;
};

export type XGrokMessageContent = {
    content_type: 'text' | 'thoughts' | 'reasoning_recap' | 'code' | 'execution_output';
    parts?: string[];
    thoughts?: XGrokThought[];
    content?: string;
};

export type XGrokMessage = {
    id: string;
    author: XGrokAuthor;
    create_time: number | null;
    update_time: number | null;
    content: XGrokMessageContent;
    status: 'finished_successfully' | 'in_progress' | 'error';
    end_turn: boolean | null;
    weight: number;
    metadata: Record<string, unknown>;
    recipient: string;
    channel: string | null;
};

export type XGrokMessageNode = {
    id: string;
    message: XGrokMessage | null;
    parent: string | null;
    children: string[];
};

export type XGrokConversationData = {
    title: string;
    create_time: number;
    update_time: number;
    mapping: Record<string, XGrokMessageNode>;
    conversation_id: string;
    current_node: string;
    moderation_results: unknown[];
    plugin_ids: string[] | null;
    gizmo_id: string | null;
    gizmo_type: string | null;
    is_archived: boolean;
    default_model_slug: string;
    safe_urls: string[];
    blocked_urls: string[];
};

export type XGrokGraphqlContext = {
    detailQueryId?: string;
    historyQueryId?: string;
    detailFeatures?: string;
    detailFieldToggles?: string;
    updatedAt: number;
};

export type XGrokHistoryPage = {
    ids: string[];
    titles: Map<string, string>;
    nextCursor: string | null;
};

export type XGrokBulkExportResult = {
    discovered: number;
    attempted: number;
    exported: number;
    failed: number;
    elapsedMs: number;
    warnings: string[];
};
