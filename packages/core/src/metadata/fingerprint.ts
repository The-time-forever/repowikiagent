/**
 * @module fingerprint
 * @description 源码内容指纹，驱动增量更新的变更检测。
 * 指纹 = sha256 前 16 位十六进制（内容哈希，跨 clone 稳定）。
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CatalogNode } from '../models/index.js';

/** 对字符串内容取指纹 */
export function hashContent(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
}

/**
 * 计算单个文件的指纹；文件不存在或读取失败返回 null。
 */
export async function fingerprintFile(rootPath: string, relPath: string): Promise<string | null> {
    try {
        const content = await fs.readFile(path.resolve(rootPath, relPath), 'utf-8');
        return hashContent(content);
    } catch {
        return null;
    }
}

/**
 * 收集目录树中出现在任一节点 dependent_files 的全部文件（去重、规范化）。
 */
export function collectDependentFiles(catalog: CatalogNode[]): string[] {
    const set = new Set<string>();
    for (const node of catalog) {
        for (const f of node.dependentFiles) {
            set.add(f.replace(/\\/g, '/'));
        }
    }
    return [...set];
}

/**
 * 为目录树的全部依赖文件计算指纹映射（source_index）。
 * 读取失败的文件跳过（不写入映射）。
 */
export async function computeSourceIndex(
    rootPath: string,
    catalog: CatalogNode[],
): Promise<Record<string, string>> {
    const files = collectDependentFiles(catalog);
    const index: Record<string, string> = {};
    await Promise.all(
        files.map(async (rel) => {
            const fp = await fingerprintFile(rootPath, rel);
            if (fp) index[rel] = fp;
        }),
    );
    return index;
}
