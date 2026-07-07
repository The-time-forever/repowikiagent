/**
 * @module answerer
 * @description 基于检索到的 wiki 页面回答问题（带来源），复用 LLMClient.chat。
 */

import type { LLMClient, ChatMessage } from '../llm/index.js';
import type { WikiLang } from '../i18n/labels.js';
import type { RetrievedPage } from './retriever.js';

/** 每页喂入的正文上限（字符） */
const MAX_CHARS_PER_PAGE = 4000;

export interface QaAnswer {
    content: string;
    /** 参与回答的页面标题 */
    sources: string[];
}

function buildSystemPrompt(lang: WikiLang): string {
    if (lang === 'zh') {
        return [
            '你是该代码仓库的向导。仅基于下方提供的 Wiki 页面摘录回答用户问题。',
            '要求：',
            '- 回答中给出依据来源：页面名称，以及摘录中出现的 file://<路径>#L<行号> 源码引用（原样保留格式）。',
            '- 摘录不足以回答时，明确说明哪些部分是推测或未覆盖，不要编造。',
            '- 回答使用中文，直接、具体。',
        ].join('\n');
    }
    return [
        'You are a guide for this code repository. Answer strictly based on the wiki page excerpts below.',
        'Requirements:',
        '- Cite your sources: page titles and any file://<path>#L<line> citations appearing in the excerpts (keep the format intact).',
        '- If the excerpts are insufficient, say so explicitly instead of guessing.',
        '- Be direct and specific.',
    ].join('\n');
}

/**
 * 回答一个问题。history 为既往轮次的 Q/A 消息（不含 system 与本轮 context）。
 */
export async function answerQuestion(
    llmClient: LLMClient,
    pages: RetrievedPage[],
    question: string,
    lang: WikiLang,
    history: ChatMessage[] = [],
): Promise<QaAnswer> {
    const excerpts = pages
        .map(({ entry }) => {
            const body =
                entry.content.length > MAX_CHARS_PER_PAGE
                    ? entry.content.slice(0, MAX_CHARS_PER_PAGE) + '\n...(截断)'
                    : entry.content;
            return `## 页面: ${entry.title} (${entry.filename})\n${body}`;
        })
        .join('\n\n---\n\n');

    const contextHeader =
        lang === 'zh' ? '以下是与问题最相关的 Wiki 页面摘录：' : 'Most relevant wiki page excerpts:';

    const messages: ChatMessage[] = [
        { role: 'system', content: buildSystemPrompt(lang) },
        ...history,
        {
            role: 'user',
            content: `${contextHeader}\n\n${excerpts}\n\n---\n\n${lang === 'zh' ? '问题' : 'Question'}: ${question}`,
        },
    ];

    const response = await llmClient.chat(messages, { temperature: 0.2 });
    return {
        content: response.content,
        sources: pages.map((p) => p.entry.title),
    };
}
