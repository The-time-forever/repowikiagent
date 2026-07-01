/**
 * @module layout
 * @description 集中定义 Wiki 输出目录布局。对齐 repowiki-generator 技能形态：
 *   <root>/<lang>/content/...        —— 分层文档页
 *   <root>/<lang>/meta/repowiki-metadata.json  —— 机器可读元数据
 *
 * 其中 <root> 默认是 <workspace>/.repowiki，可由 CLI `-o` 覆盖。
 */

import * as path from 'node:path';
import type { WikiLang } from '../i18n/labels.js';

/** 默认输出根目录名（相对工作区） */
export const WIKI_ROOT_DIRNAME = '.repowiki';

/** 元数据文件名 */
export const METADATA_FILENAME = 'repowiki-metadata.json';

/** 一套语言树的解析后路径 */
export interface WikiPaths {
    /** 输出根目录（含所有语言树） */
    root: string;
    /** 当前语言树根目录 <root>/<lang> */
    langRoot: string;
    /** 文档内容目录 <langRoot>/content */
    contentDir: string;
    /** 元数据目录 <langRoot>/meta */
    metaDir: string;
    /** 元数据文件绝对路径 */
    metadataFile: string;
}

/**
 * 推导默认输出根目录：<workspacePath>/.repowiki
 */
export function defaultWikiRoot(workspacePath: string): string {
    return path.join(workspacePath, WIKI_ROOT_DIRNAME);
}

/**
 * 基于输出根目录与语言，解析该语言树的全部路径。
 *
 * @param root - 输出根目录（默认 `defaultWikiRoot()` 结果，或 CLI `-o` 覆盖值）
 * @param lang - 语言代码
 */
export function resolveWikiPaths(root: string, lang: WikiLang): WikiPaths {
    const langRoot = path.join(root, lang);
    const contentDir = path.join(langRoot, 'content');
    const metaDir = path.join(langRoot, 'meta');
    return {
        root,
        langRoot,
        contentDir,
        metaDir,
        metadataFile: path.join(metaDir, METADATA_FILENAME),
    };
}
