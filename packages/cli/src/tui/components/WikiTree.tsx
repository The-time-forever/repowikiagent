/**
 * 左侧 Wiki 目录树：↑↓ 选择、←→ 折叠/展开（← 在叶节点回父级）、Enter 打开页面。
 */

import { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { WikiTreeNode } from 'repowiki-core';
import { flattenTree, truncate } from '../format.js';
import type { Action } from '../state.js';

interface Props {
    tree: WikiTreeNode[];
    expanded: Set<string>;
    selectedId: string | null;
    width: number;
    height: number;
    isActive: boolean;
    legacyGlyphs: boolean;
    dispatch: (action: Action) => void;
}

function buildParentMap(tree: WikiTreeNode[]): Map<string, string | null> {
    const map = new Map<string, string | null>();
    const walk = (nodes: WikiTreeNode[], parent: string | null): void => {
        for (const n of nodes) {
            map.set(n.id, parent);
            walk(n.children, n.id);
        }
    };
    walk(tree, null);
    return map;
}

export function WikiTree({ tree, expanded, selectedId, width, height, isActive, legacyGlyphs, dispatch }: Props) {
    const rows = useMemo(() => flattenTree(tree, expanded), [tree, expanded]);
    const parentMap = useMemo(() => buildParentMap(tree), [tree]);

    const glyph = legacyGlyphs
        ? { open: '- ', closed: '+ ', leaf: '  ' }
        : { open: '▾ ', closed: '▸ ', leaf: '· ' };

    const selectedIndex = Math.max(
        0,
        rows.findIndex((r) => r.node.id === selectedId),
    );

    useInput(
        (_input, key) => {
            if (rows.length === 0) return;
            const row = rows[selectedIndex];
            if (key.upArrow) {
                const next = Math.max(0, selectedIndex - 1);
                dispatch({ type: 'TREE_SELECT', id: rows[next].node.id });
            } else if (key.downArrow) {
                const next = Math.min(rows.length - 1, selectedIndex + 1);
                dispatch({ type: 'TREE_SELECT', id: rows[next].node.id });
            } else if (key.pageUp) {
                const next = Math.max(0, selectedIndex - height);
                dispatch({ type: 'TREE_SELECT', id: rows[next].node.id });
            } else if (key.pageDown) {
                const next = Math.min(rows.length - 1, selectedIndex + height);
                dispatch({ type: 'TREE_SELECT', id: rows[next].node.id });
            } else if (key.rightArrow) {
                if (row.hasChildren && !row.expanded) {
                    dispatch({ type: 'TREE_SET_EXPANDED', id: row.node.id, expanded: true });
                } else if (row.hasChildren) {
                    dispatch({ type: 'TREE_SELECT', id: row.node.children[0].id });
                }
            } else if (key.leftArrow) {
                if (row.hasChildren && row.expanded) {
                    dispatch({ type: 'TREE_SET_EXPANDED', id: row.node.id, expanded: false });
                } else {
                    const parent = parentMap.get(row.node.id);
                    if (parent) dispatch({ type: 'TREE_SELECT', id: parent });
                }
            } else if (key.return) {
                if (row.hasChildren && !row.expanded) {
                    dispatch({ type: 'TREE_SET_EXPANDED', id: row.node.id, expanded: true });
                }
                dispatch({ type: 'OPEN_PAGE', id: row.node.id });
            }
        },
        { isActive },
    );

    // 滚动窗口：让选中行尽量居中
    const offset = Math.max(0, Math.min(selectedIndex - Math.floor(height / 2), rows.length - height));
    const visible = rows.slice(offset, offset + height);
    // 边框 2 + paddingX 2
    const labelWidth = Math.max(6, width - 4);

    return (
        <Box
            flexDirection="column"
            width={width}
            borderStyle="round"
            borderColor={isActive ? 'cyan' : 'gray'}
            paddingX={1}
        >
            <Text bold dimColor={!isActive}>
                Wiki 目录 {rows.length > height ? `(${selectedIndex + 1}/${rows.length})` : ''}
            </Text>
            {visible.map((row) => {
                const isSelected = row.node.id === selectedId;
                const g = row.hasChildren ? (row.expanded ? glyph.open : glyph.closed) : glyph.leaf;
                const text = truncate(`${'  '.repeat(row.depth)}${g}${row.node.title}`, labelWidth);
                return (
                    <Text key={row.node.id} color={isSelected ? 'cyan' : undefined} inverse={isSelected && isActive}>
                        {text}
                    </Text>
                );
            })}
            {rows.length === 0 ? <Text dimColor>（无页面）</Text> : null}
        </Box>
    );
}
