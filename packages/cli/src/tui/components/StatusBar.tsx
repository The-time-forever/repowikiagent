/**
 * 底栏：临时状态消息优先，否则按当前焦点显示按键提示。
 */

import { Box, Text } from 'ink';
import type { PanelId } from '../types.js';

interface Props {
    status: string | null;
    focus: PanelId;
}

const HINTS: Record<PanelId, string> = {
    tree: 'Tab 面板  ↑↓ 选择  ←→ 折叠/展开  Enter 打开  / 搜索  a 问本页  A 问全库  r 引用  u 更新  q 退出',
    page: 'Tab 面板  ↑↓ 滚动  PgUp/PgDn 翻页  r 引用列表  o 打开源码  a 问本页  q 退出',
    chat: 'Enter 发送  Esc 返回目录树  ↑↓ 滚动聊天记录',
};

export function StatusBar({ status, focus }: Props) {
    return (
        <Box paddingX={1}>
            {status ? <Text color="yellow">{status}</Text> : <Text dimColor>{HINTS[focus]}</Text>}
        </Box>
    );
}
