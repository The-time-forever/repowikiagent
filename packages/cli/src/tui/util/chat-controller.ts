/**
 * 问答控制器：把 core qa 的检索/回答装配成 TUI 可用的单次调用。
 * page 模式 context 固定为当前页；repo 模式走全库检索。
 */

import {
    answerQuestion,
    parseCitations,
    retrieve,
    type ChatMessage,
    type LLMClient,
    type RetrievedPage,
    type SourceCitation,
    type WikiIndexEntry,
    type WikiLang,
} from 'repowiki-core';
import type { ChatContextMode } from '../types.js';

/** 保留的最大历史条数（6 轮 Q/A） */
const MAX_HISTORY_MESSAGES = 12;

export interface AskArgs {
    mode: ChatContextMode;
    question: string;
    currentPage: WikiIndexEntry | null;
    index: WikiIndexEntry[];
    llmClient: LLMClient;
    lang: WikiLang;
    topK: number;
    history: ChatMessage[];
    /** 流式增量回调（显示用途） */
    onToken?: (delta: string) => void;
    /** 流式中断重试时触发：消费方应清空已展示的草稿 */
    onStreamReset?: () => void;
}

export interface AskResult {
    content: string;
    sources: string[];
    citations: SourceCitation[];
    history: ChatMessage[];
}

export async function askQuestion(args: AskArgs): Promise<AskResult> {
    let pages: RetrievedPage[];
    if (args.mode === 'page') {
        if (!args.currentPage) throw new Error('尚未选择页面，无法针对当前页提问');
        pages = [{ entry: args.currentPage, score: 1 }];
    } else {
        pages = retrieve(args.index, args.question, args.topK);
        if (pages.length === 0) throw new Error('未在 Wiki 中检索到相关页面，请换个问法');
    }

    const history = args.history.slice(-MAX_HISTORY_MESSAGES);
    const answer = await answerQuestion(
        args.llmClient,
        pages,
        args.question,
        args.lang,
        history,
        args.onToken,
        args.onStreamReset,
    );

    const turn: ChatMessage[] = [
        { role: 'user', content: args.question },
        { role: 'assistant', content: answer.content },
    ];
    const nextHistory = [...history, ...turn].slice(-MAX_HISTORY_MESSAGES);

    return {
        content: answer.content,
        sources: answer.sources,
        citations: parseCitations(answer.content),
        history: nextHistory,
    };
}
