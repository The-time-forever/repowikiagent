/**
 * 右侧页面窗格：正文开窗滚动；r 切换到引用列表视图（↑↓ 选择、Enter/o 打开源码）。
 */

import { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { WikiIndexEntry } from 'repowiki-core';
import { ensureVisible, truncate, wrapLines } from '../format.js';
import type { Action } from '../state.js';
import type { PageView, SourceItem } from '../types.js';

interface Props {
    entry: WikiIndexEntry | null;
    view: PageView;
    scrollOffset: number;
    sourceCursor: number;
    sources: SourceItem[];
    width: number;
    height: number;
    isActive: boolean;
    dispatch: (action: Action) => void;
    onOpenSource: (item: SourceItem) => void;
}

export function PagePane(props: Props) {
    const { entry, view, scrollOffset, sourceCursor, sources, width, height, isActive, dispatch, onOpenSource } =
        props;
    const contentWidth = Math.max(10, width - 4);
    // 标题占 1 行，边框/内边距在外层扣除
    const bodyHeight = Math.max(1, height);

    const lines = useMemo(
        () => (entry ? wrapLines(entry.content || '（该页暂无内容）', contentWidth) : []),
        [entry, contentWidth],
    );
    const maxScroll = Math.max(0, lines.length - bodyHeight);

    useInput(
        (input, key) => {
            if (!entry) return;
            if (view === 'content') {
                if (key.upArrow) dispatch({ type: 'PAGE_SCROLL', delta: -1, max: maxScroll });
                else if (key.downArrow) dispatch({ type: 'PAGE_SCROLL', delta: 1, max: maxScroll });
                else if (key.pageUp) dispatch({ type: 'PAGE_SCROLL', delta: -bodyHeight, max: maxScroll });
                else if (key.pageDown) dispatch({ type: 'PAGE_SCROLL', delta: bodyHeight, max: maxScroll });
            } else {
                if (key.upArrow) dispatch({ type: 'SOURCE_MOVE', delta: -1, count: sources.length });
                else if (key.downArrow) dispatch({ type: 'SOURCE_MOVE', delta: 1, count: sources.length });
                else if (key.return || input === 'o') {
                    const item = sources[sourceCursor];
                    if (item) onOpenSource(item);
                } else if (key.escape) dispatch({ type: 'PAGE_SET_VIEW', view: 'content' });
            }
        },
        { isActive },
    );

    const title = entry ? entry.title : 'Wiki 页面';

    let body;
    if (!entry) {
        body = <Text dimColor>在左侧选择页面后回车打开；/ 可搜索页面。</Text>;
    } else if (view === 'sources') {
        const listOffset = ensureVisible(sourceCursor, 0, bodyHeight - 1);
        body = (
            <Box flexDirection="column">
                <Text dimColor>引用与关联文件（Enter/o 打开，Esc 返回正文）:</Text>
                {sources.slice(listOffset, listOffset + bodyHeight - 1).map((item, i) => {
                    const idx = listOffset + i;
                    const isSelected = idx === sourceCursor;
                    return (
                        <Text key={`${item.filePath}:${item.startLine ?? 0}:${idx}`} color={isSelected ? 'cyan' : undefined} inverse={isSelected && isActive}>
                            {truncate(`${idx + 1}. ${item.label}`, contentWidth)}
                        </Text>
                    );
                })}
                {sources.length === 0 ? <Text dimColor>（本页没有可打开的引用）</Text> : null}
            </Box>
        );
    } else {
        const visible = lines.slice(scrollOffset, scrollOffset + bodyHeight);
        body = (
            <Box flexDirection="column">
                {visible.map((line, i) => (
                    <Text key={scrollOffset + i}>{line || ' '}</Text>
                ))}
            </Box>
        );
    }

    const scrollHint =
        entry && view === 'content' && lines.length > bodyHeight
            ? ` ${scrollOffset + 1}-${Math.min(lines.length, scrollOffset + bodyHeight)}/${lines.length}`
            : '';

    return (
        <Box
            flexDirection="column"
            flexGrow={1}
            borderStyle="round"
            borderColor={isActive ? 'cyan' : 'gray'}
            paddingX={1}
        >
            <Text bold dimColor={!isActive}>
                {truncate(title, contentWidth - scrollHint.length)}
                <Text dimColor>{scrollHint}</Text>
            </Text>
            {body}
        </Box>
    );
}
