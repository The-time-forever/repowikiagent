/**
 * @module qa-session
 * @description ask / chat 共享的会话装配：语言探测、LLM 配置校验、索引加载。
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import chalk from 'chalk';
import {
    loadLLMConfig,
    validateConfig,
    LLMClient,
    loadWikiIndex,
    defaultWikiRoot,
    resolveWikiPaths,
    normalizeLang,
    type WikiLang,
    type WikiIndexEntry,
} from 'repowiki-core';

export interface QaSession {
    llmClient: LLMClient;
    index: WikiIndexEntry[];
    lang: WikiLang;
    workspacePath: string;
}

/** 未显式指定语言时，按 zh → en 顺序探测已生成的语言树 */
function detectLang(workspacePath: string): WikiLang {
    for (const lang of ['zh', 'en'] as WikiLang[]) {
        const p = resolveWikiPaths(defaultWikiRoot(workspacePath), lang).metadataFile;
        if (fs.existsSync(p)) return lang;
    }
    return 'en';
}

/**
 * 装配问答会话。配置或索引缺失时打印指引并退出进程。
 */
export async function createQaSession(targetPath: string | undefined, langOpt?: string): Promise<QaSession> {
    const workspacePath = path.resolve(targetPath || '.');
    const lang = langOpt ? normalizeLang(langOpt) : detectLang(workspacePath);

    const config = await loadLLMConfig(workspacePath);
    const errors = validateConfig(config);
    if (errors.length > 0) {
        console.error(chalk.red('错误: 问答需要 LLM 配置:'));
        for (const e of errors) console.error(`  - ${e}`);
        console.error('运行 repowiki login 或设置 REPOWIKI_API_KEY 环境变量。');
        process.exit(1);
    }

    let index: WikiIndexEntry[];
    try {
        index = await loadWikiIndex(workspacePath, lang);
    } catch (err: any) {
        console.error(chalk.red('错误: ') + (err?.message || err));
        process.exit(1);
    }

    return { llmClient: new LLMClient({ config }), index, lang, workspacePath };
}
