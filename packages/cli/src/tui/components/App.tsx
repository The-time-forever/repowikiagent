/**
 * TUI 根组件：布局、全局按键路由、生成/更新编排。
 */

import * as path from 'node:path';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { computeChangeSets, loadLLMConfig, parseCitations, validateConfig } from 'repowiki-core';
import { loadWikiData } from '../data.js';
import { buildInitialState, reducer } from '../state.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { askQuestion } from '../util/chat-controller.js';
import { openInEditor } from '../util/open-editor.js';
import type { LoadedWiki, SourceItem, TuiBase } from '../types.js';
import { ChatPane } from './ChatPane.js';
import { FirstRunScreen } from './FirstRunScreen.js';
import { GenerateScreen } from './GenerateScreen.js';
import { Header } from './Header.js';
import { PagePane } from './PagePane.js';
import { SearchOverlay } from './SearchOverlay.js';
import { SelectMenu } from './SelectMenu.js';
import { StatusBar } from './StatusBar.js';
import { WikiTree } from './WikiTree.js';

interface Props {
    base: TuiBase;
    initialData: LoadedWiki | null;
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

/** 传统 conhost 下退化为 ASCII 字形 */
const legacyGlyphs = process.platform === 'win32' && !process.env['WT_SESSION'];

export function App({ base, initialData }: Props) {
    const { exit } = useApp();
    const [data, setData] = useState<LoadedWiki | null>(initialData);
    const [state, dispatch] = useReducer(reducer, buildInitialState(initialData?.tree ?? [], initialData !== null));
    const { columns, rows } = useTerminalSize();

    // ── 布局 ────────────────────────────────────────────────
    const chatBoxHeight = clamp(Math.floor((rows - 2) * 0.32), 7, 14); // 含边框
    const midBoxHeight = Math.max(6, rows - 2 - chatBoxHeight);
    const treeWidth = clamp(Math.floor(columns * 0.32), 24, 42);
    const midContentHeight = Math.max(3, midBoxHeight - 3); // 边框 2 + 标题 1
    const chatContentHeight = Math.max(2, chatBoxHeight - 3);

    // ── 派生数据 ────────────────────────────────────────────
    const currentEntry = useMemo(
        () => (data && state.page.currentId ? (data.index.find((e) => e.id === state.page.currentId) ?? null) : null),
        [data, state.page.currentId],
    );

    const lastAnswer = useMemo(
        () => [...state.chat.entries].reverse().find((e) => e.role === 'assistant') ?? null,
        [state.chat.entries],
    );

    const sources = useMemo<SourceItem[]>(() => {
        const items: SourceItem[] = [];
        const seen = new Set<string>();
        const push = (item: SourceItem): void => {
            const key = `${item.filePath}:${item.startLine ?? 0}`;
            if (!seen.has(key)) {
                seen.add(key);
                items.push(item);
            }
        };
        if (currentEntry) {
            for (const c of parseCitations(currentEntry.content)) {
                push({
                    label: `${c.filePath}#L${c.startLine}${c.endLine !== c.startLine ? `-L${c.endLine}` : ''}`,
                    filePath: c.filePath,
                    startLine: c.startLine,
                    origin: 'citation',
                });
            }
            for (const f of currentEntry.dependentFiles) {
                push({ label: f, filePath: f, origin: 'file' });
            }
        }
        for (const c of lastAnswer?.citations ?? []) {
            push({
                label: `[答] ${c.filePath}#L${c.startLine}`,
                filePath: c.filePath,
                startLine: c.startLine,
                origin: 'answer',
            });
        }
        return items;
    }, [currentEntry, lastAnswer]);

    // ── 编排动作 ────────────────────────────────────────────
    const reload = async (): Promise<void> => {
        const loaded = await loadWikiData(base.workspacePath, base.lang);
        setData(loaded);
        dispatch({ type: 'RELOADED', tree: loaded?.tree ?? [], hasWiki: loaded !== null });
    };

    const requestGenerate = async (forceRebuild: boolean): Promise<void> => {
        const config = await loadLLMConfig(base.workspacePath);
        if (validateConfig(config).length > 0) {
            dispatch({ type: 'GENERATE_REQUEST', opts: { forceRebuild, skipLlm: false } });
            dispatch({ type: 'SET_OVERLAY', overlay: 'llmFallback' });
        } else {
            dispatch({ type: 'GENERATE_START', opts: { forceRebuild, skipLlm: false } });
        }
    };

    const handleAsk = (question: string): void => {
        if (!data) return;
        if (!data.llmClient) {
            dispatch({ type: 'CHAT_INFO', message: '问答需要 LLM 配置：请退出后运行 repowiki login（或设置 REPOWIKI_API_KEY）。' });
            return;
        }
        if (state.chat.mode === 'page' && !currentEntry) {
            dispatch({ type: 'CHAT_INFO', message: '尚未选择页面；已切换为问全库，或先在左侧选择页面。' });
            return;
        }
        const llmClient = data.llmClient;
        dispatch({ type: 'CHAT_ASK', question });
        void askQuestion({
            mode: state.chat.mode,
            question,
            currentPage: currentEntry,
            index: data.index,
            llmClient,
            lang: base.lang,
            topK: base.topK,
            history: state.chat.history,
            onToken: (delta) => dispatch({ type: 'CHAT_STREAM', delta }),
            onStreamReset: () => dispatch({ type: 'CHAT_STREAM_RESET' }),
        })
            .then((res) =>
                dispatch({
                    type: 'CHAT_ANSWERED',
                    entry: { role: 'assistant', text: res.content, sources: res.sources, citations: res.citations },
                    history: res.history,
                }),
            )
            .catch((err: unknown) =>
                dispatch({ type: 'CHAT_FAILED', message: `回答失败: ${err instanceof Error ? err.message : String(err)}` }),
            );
    };

    const handleOpenSource = (item: SourceItem): void => {
        const abs = path.isAbsolute(item.filePath) ? item.filePath : path.join(base.workspacePath, item.filePath);
        dispatch({ type: 'SET_STATUS', status: '正在打开编辑器...' });
        void openInEditor(abs, item.startLine).then((res) => dispatch({ type: 'SET_STATUS', status: res.message }));
    };

    // ── 启动时的更新检测（仅记录过 commit 的 git 仓库自动执行）──
    const checkedRef = useRef(false);
    useEffect(() => {
        if (checkedRef.current || !data || state.screen !== 'main') return;
        checkedRef.current = true;
        if (!data.metadata.generated_at_commit) return;
        void computeChangeSets(base.workspacePath, data.metadata)
            .then((changes) => {
                const total = changes.changed.size + changes.added.size + changes.deleted.size;
                if (total > 0) {
                    dispatch({
                        type: 'SHOW_UPDATE_PROMPT',
                        changed: changes.changed.size,
                        added: changes.added.size,
                        deleted: changes.deleted.size,
                    });
                }
            })
            .catch(() => undefined);
    }, [data, state.screen]);

    // ── 全局按键 ────────────────────────────────────────────
    useInput((input, key) => {
        if (state.screen !== 'main' || state.overlay !== null || state.focus === 'chat') return;
        if (input === 'q') {
            exit();
        } else if (key.tab) {
            dispatch({ type: 'CYCLE_FOCUS' });
        } else if (input === '/') {
            dispatch({ type: 'SET_OVERLAY', overlay: 'search' });
        } else if (input === 'a') {
            if (currentEntry) {
                dispatch({ type: 'CHAT_SET_MODE', mode: 'page' });
                dispatch({ type: 'SET_FOCUS', focus: 'chat' });
            } else {
                dispatch({ type: 'SET_STATUS', status: '先在左侧选择一个页面（Enter 打开）再问本页' });
            }
        } else if (input === 'A') {
            dispatch({ type: 'CHAT_SET_MODE', mode: 'repo' });
            dispatch({ type: 'SET_FOCUS', focus: 'chat' });
        } else if (input === 'r' || input === 'o') {
            if (currentEntry) {
                dispatch({ type: 'SET_FOCUS', focus: 'page' });
                dispatch({ type: 'PAGE_SET_VIEW', view: 'sources' });
            } else {
                dispatch({ type: 'SET_STATUS', status: '先打开一个页面再查看引用' });
            }
        } else if (input === 'u') {
            dispatch({ type: 'SET_OVERLAY', overlay: 'updateMenu' });
        }
    });

    // ── 屏幕分发 ────────────────────────────────────────────
    if (state.screen === 'firstRun') {
        return (
            <Box flexDirection="column" width={columns} height={rows}>
                <FirstRunScreen
                    base={base}
                    isActive={state.overlay === null}
                    onGenerate={() => void requestGenerate(false)}
                    onExit={() => exit()}
                />
                {state.overlay === 'llmFallback' ? (
                    <LlmFallback dispatch={dispatch} requestedForce={state.requestedOpts?.forceRebuild ?? false} />
                ) : null}
            </Box>
        );
    }

    if (state.screen === 'generate') {
        return (
            <Box flexDirection="column" width={columns} height={rows}>
                <GenerateScreen
                    base={base}
                    generate={state.generate}
                    dispatch={dispatch}
                    onComplete={() => void reload()}
                    onAbort={() => dispatch({ type: 'SET_SCREEN', screen: data ? 'main' : 'firstRun' })}
                />
            </Box>
        );
    }

    // main
    let middle;
    if (state.overlay === 'search' && data) {
        middle = (
            <SearchOverlay index={data.index} tree={data.tree} width={columns} isActive dispatch={dispatch} />
        );
    } else if (state.overlay === 'updatePrompt') {
        middle = (
            <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1} flexGrow={1}>
                <Text color="yellow">
                    仓库自上次生成后有变更
                    {state.pendingUpdate
                        ? `（修改 ${state.pendingUpdate.changed} / 新增 ${state.pendingUpdate.added} / 删除 ${state.pendingUpdate.deleted}）`
                        : ''}
                </Text>
                <Box marginTop={1}>
                    <SelectMenu
                        isActive
                        items={[
                            { label: '更新 Wiki（增量）', value: 'update' },
                            { label: '跳过', value: 'skip' },
                        ]}
                        onSelect={(v) => {
                            if (v === 'update') void requestGenerate(false);
                            else dispatch({ type: 'SET_OVERLAY', overlay: null });
                        }}
                        onCancel={() => dispatch({ type: 'SET_OVERLAY', overlay: null })}
                    />
                </Box>
            </Box>
        );
    } else if (state.overlay === 'updateMenu') {
        middle = (
            <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1} flexGrow={1}>
                <Text bold>更新 Wiki</Text>
                <Box marginTop={1}>
                    <SelectMenu
                        isActive
                        items={[
                            { label: '增量更新', value: 'incremental', hint: '只重写受变更影响的页面' },
                            { label: '全量重建', value: 'force' },
                            { label: '取消', value: 'cancel' },
                        ]}
                        onSelect={(v) => {
                            if (v === 'cancel') dispatch({ type: 'SET_OVERLAY', overlay: null });
                            else void requestGenerate(v === 'force');
                        }}
                        onCancel={() => dispatch({ type: 'SET_OVERLAY', overlay: null })}
                    />
                </Box>
            </Box>
        );
    } else if (state.overlay === 'llmFallback') {
        middle = <LlmFallback dispatch={dispatch} requestedForce={state.requestedOpts?.forceRebuild ?? false} />;
    } else {
        middle = (
            <Box height={midBoxHeight}>
                <WikiTree
                    tree={data?.tree ?? []}
                    expanded={state.tree.expanded}
                    selectedId={state.tree.selectedId}
                    width={treeWidth}
                    height={midContentHeight}
                    isActive={state.focus === 'tree'}
                    legacyGlyphs={legacyGlyphs}
                    dispatch={dispatch}
                />
                <PagePane
                    entry={currentEntry}
                    view={state.page.view}
                    scrollOffset={state.page.scrollOffset}
                    sourceCursor={state.page.sourceCursor}
                    sources={sources}
                    width={columns - treeWidth}
                    height={midContentHeight}
                    isActive={state.focus === 'page'}
                    dispatch={dispatch}
                    onOpenSource={handleOpenSource}
                />
            </Box>
        );
    }

    return (
        <Box flexDirection="column" width={columns} height={rows}>
            <Header base={base} data={data} />
            {middle}
            <ChatPane
                chat={state.chat}
                currentPageTitle={currentEntry?.title ?? null}
                llmAvailable={Boolean(data?.llmClient)}
                width={columns}
                height={chatContentHeight}
                isActive={state.focus === 'chat' && state.overlay === null}
                dispatch={dispatch}
                onAsk={handleAsk}
            />
            <StatusBar status={state.status} focus={state.focus} />
        </Box>
    );
}

/** LLM 配置无效时的降级菜单 */
function LlmFallback({
    dispatch,
    requestedForce,
}: {
    dispatch: (action: import('../state.js').Action) => void;
    requestedForce: boolean;
}) {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
            <Text color="yellow">未检测到有效的 LLM 配置（可退出后运行 repowiki login 配置）。</Text>
            <Box marginTop={1}>
                <SelectMenu
                    isActive
                    items={[
                        { label: '离线生成（不调用大模型）', value: 'offline', hint: '结构与图完整，正文为确定性摘要' },
                        { label: '取消', value: 'cancel' },
                    ]}
                    onSelect={(v) => {
                        if (v === 'offline') {
                            dispatch({ type: 'GENERATE_START', opts: { forceRebuild: requestedForce, skipLlm: true } });
                        } else {
                            dispatch({ type: 'SET_OVERLAY', overlay: null });
                        }
                    }}
                    onCancel={() => dispatch({ type: 'SET_OVERLAY', overlay: null })}
                />
            </Box>
        </Box>
    );
}
