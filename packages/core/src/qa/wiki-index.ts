/**
 * @module wiki-index
 * @description 加载已生成的 Wiki 作为问答检索的索引：目录条目 + 页面正文。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { defaultWikiRoot, resolveWikiPaths } from '../output/layout.js';
import { readMetadata } from '../metadata/metadata-writer.js';
import type { WikiLang } from '../i18n/labels.js';

/** 供检索与问答使用的单页索引条目 */
export interface WikiIndexEntry {
    id: string;
    title: string;
    /** 目录条目里的 slug/描述 */
    summary: string;
    filename: string;
    /** 页面 Markdown 正文（读取失败为空串） */
    content: string;
    dependentFiles: string[];
}

/** 抛给 CLI 呈现的可指引错误 */
export class WikiNotFoundError extends Error {
    constructor(workspacePath: string, lang: WikiLang) {
        super(
            `未找到 ${lang} 语言的 Wiki 元数据（${workspacePath}）。请先运行: repowiki generate . --lang ${lang}`,
        );
        this.name = 'WikiNotFoundError';
    }
}

/**
 * 加载某语言树的 Wiki 索引。
 *
 * @throws {WikiNotFoundError} 元数据不存在或不可解析
 */
export async function loadWikiIndex(workspacePath: string, lang: WikiLang): Promise<WikiIndexEntry[]> {
    const paths = resolveWikiPaths(defaultWikiRoot(workspacePath), lang);
    const metadata = await readMetadata(paths.metadataFile);
    if (!metadata) {
        throw new WikiNotFoundError(workspacePath, lang);
    }

    const entries: WikiIndexEntry[] = [];
    for (const c of metadata.wiki_catalogs) {
        let content = '';
        try {
            content = await fs.readFile(path.join(paths.contentDir, c.filename), 'utf-8');
        } catch {
            // 页面文件缺失时仅用目录信息参与检索
        }
        entries.push({
            id: c.id,
            title: c.name,
            summary: c.description,
            filename: c.filename,
            content,
            dependentFiles: c.dependent_files ? c.dependent_files.split(',').filter(Boolean) : [],
        });
    }
    return entries;
}
