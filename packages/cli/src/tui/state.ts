/**
 * TUI 状态与 reducer（纯函数，不 import ink）。
 */

import type { PipelineEvent, WikiTreeNode } from 'repowiki-core';
import type {
    ChatContextMode,
    ChatEntry,
    ChatMessage,
    OverlayId,
    PageView,
    PanelId,
    ScreenId,
} from './types.js';

export interface GenerateOpts {
    forceRebuild: boolean;
    skipLlm: boolean;
}

export interface GenerateState {
    opts: GenerateOpts;
    stageOrder: string[];
    stages: Record<string, { progress: number; message: string }>;
    warns: string[];
    error: string | null;
    done: boolean;
}

export interface AppState {
    screen: ScreenId;
    overlay: OverlayId;
    focus: PanelId;
    tree: { expanded: Set<string>; selectedId: string | null };
    page: { currentId: string | null; scrollOffset: number; view: PageView; sourceCursor: number };
    chat: {
        entries: ChatEntry[];
        history: ChatMessage[];
        mode: ChatContextMode;
        pending: boolean;
        /** 流式回答的草稿内容（pending 期间逐段累加，最终由 CHAT_ANSWERED 替换） */
        draft: string | null;
        scrollOffset: number; // 距底部的行数，0 = 贴底
    };
    generate: GenerateState;
    /** 等待 llmFallback 确认的生成请求 */
    requestedOpts: GenerateOpts | null;
    pendingUpdate: { changed: number; added: number; deleted: number } | null;
    status: string | null;
}

export type Action =
    | { type: 'SET_FOCUS'; focus: PanelId }
    | { type: 'CYCLE_FOCUS' }
    | { type: 'SET_OVERLAY'; overlay: OverlayId }
    | { type: 'TREE_SELECT'; id: string | null }
    | { type: 'TREE_TOGGLE'; id: string }
    | { type: 'TREE_SET_EXPANDED'; id: string; expanded: boolean }
    | { type: 'OPEN_PAGE'; id: string; ancestors?: string[] }
    | { type: 'PAGE_SCROLL'; delta: number; max: number }
    | { type: 'PAGE_SET_VIEW'; view: PageView }
    | { type: 'SOURCE_MOVE'; delta: number; count: number }
    | { type: 'CHAT_SET_MODE'; mode: ChatContextMode }
    | { type: 'CHAT_ASK'; question: string }
    | { type: 'CHAT_STREAM'; delta: string }
    | { type: 'CHAT_STREAM_RESET' }
    | { type: 'CHAT_ANSWERED'; entry: ChatEntry; history: ChatMessage[] }
    | { type: 'CHAT_FAILED'; message: string }
    | { type: 'CHAT_INFO'; message: string }
    | { type: 'CHAT_SCROLL'; delta: number; max: number }
    | { type: 'GENERATE_REQUEST'; opts: GenerateOpts }
    | { type: 'GENERATE_START'; opts: GenerateOpts }
    | { type: 'PIPELINE_EVENT'; event: PipelineEvent }
    | { type: 'SET_SCREEN'; screen: ScreenId }
    | { type: 'SET_STATUS'; status: string | null }
    | { type: 'SHOW_UPDATE_PROMPT'; changed: number; added: number; deleted: number }
    | { type: 'RELOADED'; tree: WikiTreeNode[]; hasWiki: boolean };

const emptyGenerate = (opts: GenerateOpts): GenerateState => ({
    opts,
    stageOrder: [],
    stages: {},
    warns: [],
    error: null,
    done: false,
});

/** 默认展开全部顶层节点，选中第一行 */
export function initialTreeState(tree: WikiTreeNode[]): AppState['tree'] {
    const expanded = new Set<string>();
    for (const root of tree) {
        if (root.children.length > 0) expanded.add(root.id);
    }
    return { expanded, selectedId: tree[0]?.id ?? null };
}

export function buildInitialState(tree: WikiTreeNode[], hasWiki: boolean): AppState {
    return {
        screen: hasWiki ? 'main' : 'firstRun',
        overlay: null,
        focus: 'tree',
        tree: initialTreeState(tree),
        page: { currentId: null, scrollOffset: 0, view: 'content', sourceCursor: 0 },
        chat: { entries: [], history: [], mode: 'repo', pending: false, draft: null, scrollOffset: 0 },
        generate: emptyGenerate({ forceRebuild: false, skipLlm: false }),
        requestedOpts: null,
        pendingUpdate: null,
        status: null,
    };
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

const FOCUS_ORDER: PanelId[] = ['tree', 'page', 'chat'];

export function reducer(state: AppState, action: Action): AppState {
    switch (action.type) {
        case 'SET_FOCUS':
            return { ...state, focus: action.focus, status: null };
        case 'CYCLE_FOCUS': {
            const next = FOCUS_ORDER[(FOCUS_ORDER.indexOf(state.focus) + 1) % FOCUS_ORDER.length];
            return { ...state, focus: next, status: null };
        }
        case 'SET_OVERLAY':
            return { ...state, overlay: action.overlay };
        case 'TREE_SELECT':
            return { ...state, tree: { ...state.tree, selectedId: action.id } };
        case 'TREE_TOGGLE': {
            const expanded = new Set(state.tree.expanded);
            if (expanded.has(action.id)) expanded.delete(action.id);
            else expanded.add(action.id);
            return { ...state, tree: { ...state.tree, expanded } };
        }
        case 'TREE_SET_EXPANDED': {
            const expanded = new Set(state.tree.expanded);
            if (action.expanded) expanded.add(action.id);
            else expanded.delete(action.id);
            return { ...state, tree: { ...state.tree, expanded } };
        }
        case 'OPEN_PAGE': {
            const expanded = new Set(state.tree.expanded);
            for (const id of action.ancestors ?? []) expanded.add(id);
            // 换页时清空"针对当前页"的对话历史，避免上下文串页
            const chat =
                state.chat.mode === 'page' && state.page.currentId !== action.id
                    ? { ...state.chat, history: [] }
                    : state.chat;
            return {
                ...state,
                overlay: null,
                tree: { expanded, selectedId: action.id },
                page: { currentId: action.id, scrollOffset: 0, view: 'content', sourceCursor: 0 },
                chat,
            };
        }
        case 'PAGE_SCROLL':
            return {
                ...state,
                page: {
                    ...state.page,
                    scrollOffset: clamp(state.page.scrollOffset + action.delta, 0, Math.max(0, action.max)),
                },
            };
        case 'PAGE_SET_VIEW':
            return { ...state, page: { ...state.page, view: action.view, sourceCursor: 0 } };
        case 'SOURCE_MOVE':
            return {
                ...state,
                page: {
                    ...state.page,
                    sourceCursor: clamp(state.page.sourceCursor + action.delta, 0, Math.max(0, action.count - 1)),
                },
            };
        case 'CHAT_SET_MODE': {
            const history = state.chat.mode === action.mode ? state.chat.history : [];
            return { ...state, chat: { ...state.chat, mode: action.mode, history } };
        }
        case 'CHAT_ASK':
            return {
                ...state,
                chat: {
                    ...state.chat,
                    pending: true,
                    draft: null,
                    scrollOffset: 0,
                    entries: [...state.chat.entries, { role: 'user', text: action.question }],
                },
            };
        case 'CHAT_STREAM':
            // 非 pending 时的迟到增量直接丢弃（例如已 CHAT_FAILED）
            if (!state.chat.pending) return state;
            return {
                ...state,
                chat: { ...state.chat, draft: (state.chat.draft ?? '') + action.delta, scrollOffset: 0 },
            };
        case 'CHAT_STREAM_RESET':
            return { ...state, chat: { ...state.chat, draft: null } };
        case 'CHAT_ANSWERED':
            return {
                ...state,
                chat: {
                    ...state.chat,
                    pending: false,
                    draft: null,
                    scrollOffset: 0,
                    entries: [...state.chat.entries, action.entry],
                    history: action.history,
                },
            };
        case 'CHAT_FAILED':
            return {
                ...state,
                chat: {
                    ...state.chat,
                    pending: false,
                    draft: null,
                    scrollOffset: 0,
                    entries: [...state.chat.entries, { role: 'error', text: action.message }],
                },
            };
        case 'CHAT_INFO':
            return {
                ...state,
                chat: {
                    ...state.chat,
                    scrollOffset: 0,
                    entries: [...state.chat.entries, { role: 'info', text: action.message }],
                },
            };
        case 'CHAT_SCROLL':
            return {
                ...state,
                chat: {
                    ...state.chat,
                    scrollOffset: clamp(state.chat.scrollOffset + action.delta, 0, Math.max(0, action.max)),
                },
            };
        case 'GENERATE_REQUEST':
            return { ...state, requestedOpts: action.opts };
        case 'GENERATE_START':
            return {
                ...state,
                screen: 'generate',
                overlay: null,
                requestedOpts: null,
                generate: emptyGenerate(action.opts),
            };
        case 'PIPELINE_EVENT': {
            const g = state.generate;
            const event = action.event;
            if (event.type === 'PROGRESS') {
                const stageOrder = g.stages[event.stage] ? g.stageOrder : [...g.stageOrder, event.stage];
                return {
                    ...state,
                    generate: {
                        ...g,
                        stageOrder,
                        stages: { ...g.stages, [event.stage]: { progress: event.progress, message: event.message } },
                    },
                };
            }
            if (event.type === 'WARN') {
                return { ...state, generate: { ...g, warns: [...g.warns, `[${event.stage}] ${event.message}`] } };
            }
            if (event.type === 'DONE') {
                return { ...state, generate: { ...g, done: true } };
            }
            if (event.type === 'ERROR') {
                // runPipeline 会同时 emit ERROR 与 rethrow，双路径去重
                if (g.error) return state;
                return { ...state, generate: { ...g, error: event.message } };
            }
            return state;
        }
        case 'SET_SCREEN':
            return { ...state, screen: action.screen, overlay: null };
        case 'SET_STATUS':
            return { ...state, status: action.status };
        case 'SHOW_UPDATE_PROMPT':
            return {
                ...state,
                overlay: 'updatePrompt',
                pendingUpdate: { changed: action.changed, added: action.added, deleted: action.deleted },
            };
        case 'RELOADED':
            return {
                ...buildInitialState(action.tree, action.hasWiki),
                chat: { ...state.chat, history: [], pending: false, draft: null },
                status: action.hasWiki ? 'Wiki 已更新' : null,
            };
        default:
            return state;
    }
}
