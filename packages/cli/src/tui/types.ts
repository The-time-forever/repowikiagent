/**
 * TUI 共享类型。
 */

import type {
    ChatMessage,
    LLMClient,
    RepowikiMetadata,
    SourceCitation,
    WikiIndexEntry,
    WikiLang,
    WikiTreeNode,
} from 'repowiki-core';

/** 启动参数与不随 wiki 重建变化的基础信息 */
export interface TuiBase {
    workspacePath: string;
    lang: WikiLang;
    topK: number;
}

/** 已加载的 wiki 数据（生成/更新完成后整体重建） */
export interface LoadedWiki {
    metadata: RepowikiMetadata;
    tree: WikiTreeNode[];
    index: WikiIndexEntry[];
    llmClient: LLMClient | null;
    llmErrors: string[];
}

export type PanelId = 'tree' | 'page' | 'chat';
export type ScreenId = 'main' | 'firstRun' | 'generate';
export type OverlayId = 'search' | 'updatePrompt' | 'updateMenu' | 'llmFallback' | null;
export type ChatContextMode = 'page' | 'repo';
export type PageView = 'content' | 'sources';

/** 聊天面板中的一条记录 */
export interface ChatEntry {
    role: 'user' | 'assistant' | 'info' | 'error';
    text: string;
    sources?: string[];
    citations?: SourceCitation[];
}

/** 树面板中一行（扁平化后的可见行） */
export interface FlatTreeRow {
    node: WikiTreeNode;
    depth: number;
    hasChildren: boolean;
    expanded: boolean;
}

/** 引用列表中的一项（含 dependentFiles 这种无行号来源） */
export interface SourceItem {
    label: string;
    filePath: string;
    startLine?: number;
    origin: 'citation' | 'file' | 'answer';
}

export type { ChatMessage };
