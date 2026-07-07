/**
 * TUI 数据装配：语言探测、wiki 数据加载/重载。
 * 与命令层 createQaSession 的区别：任何缺失（无 wiki / 无 LLM 配置）
 * 都以返回值表达，绝不 process.exit —— 无 key 时浏览必须可用。
 */

import * as fs from 'node:fs';
import {
    buildWikiTree,
    defaultWikiRoot,
    LLMClient,
    loadLLMConfig,
    loadWikiIndex,
    normalizeLang,
    readMetadata,
    resolveWikiPaths,
    validateConfig,
    type WikiLang,
} from 'repowiki-core';
import type { LoadedWiki } from './types.js';

/** 探测已生成的语言树（zh → en）；都没有返回 null */
export function detectExistingLang(workspacePath: string): WikiLang | null {
    for (const lang of ['zh', 'en'] as WikiLang[]) {
        const paths = resolveWikiPaths(defaultWikiRoot(workspacePath), lang);
        if (fs.existsSync(paths.metadataFile)) return lang;
    }
    return null;
}

/** 决定 TUI 使用的语言：显式参数 > 已生成语言 > zh（首次生成默认） */
export function resolveTuiLang(workspacePath: string, langOpt?: string): WikiLang {
    if (langOpt) return normalizeLang(langOpt);
    return detectExistingLang(workspacePath) ?? 'zh';
}

/** 加载 wiki 数据；无元数据返回 null（进入首次使用流程） */
export async function loadWikiData(workspacePath: string, lang: WikiLang): Promise<LoadedWiki | null> {
    const paths = resolveWikiPaths(defaultWikiRoot(workspacePath), lang);
    const metadata = await readMetadata(paths.metadataFile);
    if (!metadata) return null;

    const index = await loadWikiIndex(workspacePath, lang);
    const config = await loadLLMConfig(workspacePath);
    const llmErrors = validateConfig(config);
    const llmClient = llmErrors.length === 0 ? new LLMClient({ config }) : null;

    return {
        metadata,
        tree: buildWikiTree(metadata),
        index,
        llmClient,
        llmErrors,
    };
}
