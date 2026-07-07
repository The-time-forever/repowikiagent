/**
 * 底部对话面板：滚动聊天记录 + 输入框。
 * a/A 切换"问本页/问全库"由 App 全局键处理；此处负责输入与展示。
 */

import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { wrapLines } from '../format.js';
import type { Action } from '../state.js';
import type { AppState } from '../state.js';
import type { ChatEntry } from '../types.js';

interface Props {
    chat: AppState['chat'];
    currentPageTitle: string | null;
    llmAvailable: boolean;
    width: number;
    height: number;
    isActive: boolean;
    dispatch: (action: Action) => void;
    onAsk: (question: string) => void;
}

interface LogLine {
    text: string;
    color?: string;
    dim?: boolean;
}

function entryLines(entry: ChatEntry, width: number): LogLine[] {
    const lines: LogLine[] = [];
    if (entry.role === 'user') {
        for (const l of wrapLines(`你> ${entry.text}`, width)) lines.push({ text: l, color: 'cyan' });
    } else if (entry.role === 'assistant') {
        for (const l of wrapLines(entry.text, width)) lines.push({ text: l });
        if (entry.sources && entry.sources.length > 0) {
            for (const l of wrapLines(`来源: ${entry.sources.join('、')}`, width)) {
                lines.push({ text: l, dim: true });
            }
        }
        if (entry.citations && entry.citations.length > 0) {
            lines.push({ text: `（${entry.citations.length} 条源码引用，按 r 查看并打开）`, dim: true });
        }
    } else if (entry.role === 'error') {
        for (const l of wrapLines(entry.text, width)) lines.push({ text: l, color: 'red' });
    } else {
        for (const l of wrapLines(entry.text, width)) lines.push({ text: l, color: 'yellow' });
    }
    return lines;
}

export function ChatPane(props: Props) {
    const { chat, currentPageTitle, llmAvailable, width, height, isActive, dispatch, onAsk } = props;
    const [input, setInput] = useState('');
    const contentWidth = Math.max(10, width - 4);
    // 输入行占 1 行
    const logHeight = Math.max(1, height - 1);

    const lines = useMemo(() => {
        const all: LogLine[] = [];
        for (const entry of chat.entries) all.push(...entryLines(entry, contentWidth));
        if (chat.pending) all.push({ text: '思考中...', dim: true });
        return all;
    }, [chat.entries, chat.pending, contentWidth]);

    const maxScroll = Math.max(0, lines.length - logHeight);
    const start = Math.max(0, lines.length - logHeight - Math.min(chat.scrollOffset, maxScroll));
    const visible = lines.slice(start, start + logHeight);

    useInput(
        (_input, key) => {
            if (key.escape) dispatch({ type: 'SET_FOCUS', focus: 'tree' });
            else if (key.upArrow) dispatch({ type: 'CHAT_SCROLL', delta: 1, max: maxScroll });
            else if (key.downArrow) dispatch({ type: 'CHAT_SCROLL', delta: -1, max: maxScroll });
        },
        { isActive },
    );

    const submit = (value: string): void => {
        const text = value.trim();
        if (!text || chat.pending) return;
        setInput('');
        onAsk(text);
    };

    const modeLabel =
        chat.mode === 'page' ? `问本页${currentPageTitle ? `·${currentPageTitle}` : ''}` : '问全库';
    const placeholder = llmAvailable
        ? '输入问题，回车发送（a 问本页 / A 问全库）'
        : '问答需要 LLM 配置，请先运行 repowiki login';

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={isActive ? 'cyan' : 'gray'}
            paddingX={1}
            height={height + 3}
        >
            <Box flexDirection="column" height={logHeight}>
                {lines.length === 0 ? (
                    <Text dimColor>对生成的 Wiki 提问；回答会给出页面来源与源码引用。</Text>
                ) : (
                    visible.map((line, i) => (
                        <Text key={start + i} color={line.color} dimColor={line.dim}>
                            {line.text || ' '}
                        </Text>
                    ))
                )}
            </Box>
            <Box>
                <Text color="magenta">[{modeLabel}] </Text>
                <TextInput
                    value={input}
                    onChange={setInput}
                    onSubmit={submit}
                    focus={isActive}
                    placeholder={placeholder}
                />
            </Box>
        </Box>
    );
}
