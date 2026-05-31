import path from 'node:path';

import type { FileNode } from '../models/file-reference.js';

// ---------------------------------------------------------------------------
// 内部数据结构
// ---------------------------------------------------------------------------

/** 目录树中的一个节点 (中间表示) */
interface TreeNode {
    /** 节点名称 (文件名或目录名) */
    name: string;
    /** 是否为目录 */
    isDir: boolean;
    /** 子节点 (仅目录有效) */
    children: Map<string, TreeNode>;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 将扁平文件列表构建为嵌套树结构。
 */
function buildTree(files: FileNode[], rootPath: string): TreeNode {
    const root: TreeNode = {
        name: path.basename(rootPath),
        isDir: true,
        children: new Map(),
    };

    for (const file of files) {
        const segments = file.relativePath.split('/');
        let current = root;

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const isLast = i === segments.length - 1;

            if (!current.children.has(seg)) {
                current.children.set(seg, {
                    name: seg,
                    isDir: !isLast,
                    children: new Map(),
                });
            }

            current = current.children.get(seg)!;
        }
    }

    return root;
}

/**
 * 统计树中所有叶子文件数量。
 */
function countFiles(node: TreeNode): number {
    if (!node.isDir || node.children.size === 0) {
        return node.isDir ? 0 : 1;
    }
    let count = 0;
    for (const child of node.children.values()) {
        count += countFiles(child);
    }
    return count;
}

/**
 * 统计树中所有目录数量 (不含根节点自身)。
 */
function countDirectories(node: TreeNode): number {
    let count = 0;
    for (const child of node.children.values()) {
        if (child.isDir) {
            count += 1 + countDirectories(child);
        }
    }
    return count;
}

/**
 * 递归渲染树字符串。
 *
 * @param node   - 当前节点
 * @param prefix - 当前行前缀 (用于缩进)
 * @param lines  - 输出行收集器
 */
function renderNode(
    node: TreeNode,
    prefix: string,
    lines: string[],
): void {
    // 对子节点排序: 目录在前，同类按名称排序
    const sorted = [...node.children.entries()].sort(([, a], [, b]) => {
        if (a.isDir !== b.isDir) {
            return a.isDir ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < sorted.length; i++) {
        const [, child] = sorted[i];
        const isLast = i === sorted.length - 1;
        const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
        const childPrefix = isLast ? '    ' : '\u2502   ';

        const displayName = child.isDir ? `${child.name}/` : child.name;
        lines.push(`${prefix}${connector}${displayName}`);

        if (child.isDir && child.children.size > 0) {
            renderNode(child, prefix + childPrefix, lines);
        }
    }
}

// ---------------------------------------------------------------------------
// 核心 API
// ---------------------------------------------------------------------------

/**
 * 将扁平的 {@link FileNode} 列表渲染为可读的树形文本，类似 `tree` 命令输出。
 *
 * 使用 Unicode box-drawing 字符绘制分支 (├──, └──, │)。
 * 输出末尾附带文件数 / 目录数汇总。
 *
 * @param files    - 扁平的 FileNode 列表 (由 `scanDirectory` 返回)
 * @param rootPath - 项目根目录的绝对路径
 * @returns 多行字符串形式的目录树
 *
 * @example
 * ```ts
 * const files = await scanDirectory('/project');
 * const tree  = buildTreeString(files, '/project');
 * console.log(tree);
 * ```
 */
export function buildTreeString(files: FileNode[], rootPath: string): string {
    if (files.length === 0) {
        const rootName = path.basename(rootPath);
        return `${rootName}/\n\n0 directories, 0 files`;
    }

    const root = buildTree(files, rootPath);
    const lines: string[] = [`${root.name}/`];

    renderNode(root, '', lines);

    const dirCount = countDirectories(root);
    const fileCount = countFiles(root);
    lines.push('');
    lines.push(`${dirCount} directories, ${fileCount} files`);

    return lines.join('\n');
}
