/**
 * 纯函数工具：树扁平化、按显示宽度折行。
 * 不 import ink，保证可独立单测。
 */

import type { WikiTreeNode } from 'repowiki-core';
import type { FlatTreeRow } from './types.js';

/** 终端显示宽度（CJK 按 2 计，与 generate.ts 的表格对齐口径一致） */
export function displayWidth(text: string): number {
    return text.replace(/[^\x00-\xff]/g, 'xx').length;
}

/** 按显示宽度截断并在超出时加省略号 */
export function truncate(text: string, width: number): string {
    if (displayWidth(text) <= width) return text;
    let out = '';
    let w = 0;
    for (const ch of text) {
        const cw = /[^\x00-\xff]/.test(ch) ? 2 : 1;
        if (w + cw > width - 1) break;
        out += ch;
        w += cw;
    }
    return `${out}…`;
}

/**
 * 把文本折成不超过 width 显示宽度的行数组。
 * 已有换行保留；超长行按宽度硬折（对 CJK 友好，不做单词边界优化）。
 */
export function wrapLines(text: string, width: number): string[] {
    const result: string[] = [];
    const safeWidth = Math.max(4, width);
    for (const raw of text.split('\n')) {
        if (displayWidth(raw) <= safeWidth) {
            result.push(raw);
            continue;
        }
        let line = '';
        let w = 0;
        for (const ch of raw) {
            const cw = /[^\x00-\xff]/.test(ch) ? 2 : 1;
            if (w + cw > safeWidth) {
                result.push(line);
                line = '';
                w = 0;
            }
            line += ch;
            w += cw;
        }
        if (line) result.push(line);
    }
    return result;
}

/** 按展开状态把树扁平化为可见行列表（先序） */
export function flattenTree(nodes: WikiTreeNode[], expanded: Set<string>): FlatTreeRow[] {
    const rows: FlatTreeRow[] = [];
    const walk = (list: WikiTreeNode[], depth: number): void => {
        for (const node of list) {
            const hasChildren = node.children.length > 0;
            const isExpanded = expanded.has(node.id);
            rows.push({ node, depth, hasChildren, expanded: isExpanded });
            if (hasChildren && isExpanded) walk(node.children, depth + 1);
        }
    };
    walk(nodes, 0);
    return rows;
}

/** 查找 id 的祖先路径（不含自身）；找不到返回 null */
export function findAncestors(nodes: WikiTreeNode[], id: string): string[] | null {
    const walk = (list: WikiTreeNode[], trail: string[]): string[] | null => {
        for (const node of list) {
            if (node.id === id) return trail;
            const found = walk(node.children, [...trail, node.id]);
            if (found) return found;
        }
        return null;
    };
    return walk(nodes, []);
}

/** 在树中按 id 找节点 */
export function findNode(nodes: WikiTreeNode[], id: string): WikiTreeNode | null {
    for (const node of nodes) {
        if (node.id === id) return node;
        const found = findNode(node.children, id);
        if (found) return found;
    }
    return null;
}

/**
 * 计算滚动窗口起点：保证 cursor 在 [offset, offset+height) 内。
 */
export function ensureVisible(cursor: number, offset: number, height: number): number {
    if (cursor < offset) return cursor;
    if (cursor >= offset + height) return cursor - height + 1;
    return offset;
}
