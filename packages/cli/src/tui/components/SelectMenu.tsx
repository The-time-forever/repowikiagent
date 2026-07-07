/**
 * 通用纵向选择菜单：↑↓ 移动、Enter 确认、Esc 取消。
 */

import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface MenuItem<T extends string = string> {
    label: string;
    value: T;
    hint?: string;
}

interface Props<T extends string> {
    items: Array<MenuItem<T>>;
    isActive: boolean;
    onSelect: (value: T) => void;
    onCancel?: () => void;
}

export function SelectMenu<T extends string>({ items, isActive, onSelect, onCancel }: Props<T>) {
    const [cursor, setCursor] = useState(0);

    useInput(
        (_input, key) => {
            if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
            else if (key.downArrow) setCursor((c) => Math.min(items.length - 1, c + 1));
            else if (key.return) onSelect(items[cursor].value);
            else if (key.escape && onCancel) onCancel();
        },
        { isActive },
    );

    return (
        <Box flexDirection="column">
            {items.map((item, i) => (
                <Box key={item.value}>
                    <Text color={i === cursor ? 'cyan' : undefined} bold={i === cursor}>
                        {i === cursor ? '> ' : '  '}
                        {item.label}
                    </Text>
                    {item.hint ? <Text dimColor>  {item.hint}</Text> : null}
                </Box>
            ))}
        </Box>
    );
}
