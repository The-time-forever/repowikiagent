/**
 * 搜索弹层（/）：按标题/摘要/正文/关联文件路径搜索页面，Enter 跳转。
 * <2 字符走标题 includes；否则复用 core retrieve 评分，150ms 防抖。
 */

import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { retrieve, type WikiIndexEntry, type WikiTreeNode } from 'repowiki-core';
import { findAncestors, truncate } from '../format.js';
import type { Action } from '../state.js';

interface Props {
    index: WikiIndexEntry[];
    tree: WikiTreeNode[];
    width: number;
    isActive: boolean;
    dispatch: (action: Action) => void;
}

interface Hit {
    id: string;
    title: string;
}

const MAX_RESULTS = 10;
const DEBOUNCE_MS = 150;

export function SearchOverlay({ index, tree, width, isActive, dispatch }: Props) {
    const [query, setQuery] = useState('');
    const [hits, setHits] = useState<Hit[]>([]);
    const [cursor, setCursor] = useState(0);

    useEffect(() => {
        const q = query.trim();
        if (!q) {
            setHits([]);
            setCursor(0);
            return;
        }
        const timer = setTimeout(() => {
            let next: Hit[];
            if (q.length < 2) {
                next = index
                    .filter((e) => e.title.toLowerCase().includes(q.toLowerCase()))
                    .slice(0, MAX_RESULTS)
                    .map((e) => ({ id: e.id, title: e.title }));
            } else {
                next = retrieve(index, q, MAX_RESULTS).map((r) => ({ id: r.entry.id, title: r.entry.title }));
            }
            setHits(next);
            setCursor(0);
        }, DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [query, index]);

    useInput(
        (_input, key) => {
            if (key.escape) {
                dispatch({ type: 'SET_OVERLAY', overlay: null });
            } else if (key.upArrow) {
                setCursor((c) => Math.max(0, c - 1));
            } else if (key.downArrow) {
                setCursor((c) => Math.min(Math.max(0, hits.length - 1), c + 1));
            } else if (key.return) {
                const hit = hits[cursor];
                if (hit) {
                    dispatch({
                        type: 'OPEN_PAGE',
                        id: hit.id,
                        ancestors: findAncestors(tree, hit.id) ?? [],
                    });
                    dispatch({ type: 'SET_FOCUS', focus: 'page' });
                }
            }
        },
        { isActive },
    );

    const contentWidth = Math.max(10, width - 6);

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} flexGrow={1}>
            <Box>
                <Text bold color="cyan">
                    搜索 Wiki:{' '}
                </Text>
                <TextInput value={query} onChange={setQuery} focus={isActive} placeholder="标题 / 摘要 / 正文 / 文件路径" />
            </Box>
            <Box flexDirection="column" marginTop={1}>
                {hits.map((hit, i) => (
                    <Text key={hit.id} color={i === cursor ? 'cyan' : undefined} inverse={i === cursor}>
                        {truncate(`${i + 1}. ${hit.title}`, contentWidth)}
                    </Text>
                ))}
                {query.trim() && hits.length === 0 ? <Text dimColor>无匹配页面</Text> : null}
                <Text dimColor>↑↓ 选择  Enter 打开  Esc 关闭</Text>
            </Box>
        </Box>
    );
}
