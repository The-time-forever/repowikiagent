/**
 * 首次使用屏：当前目录还没有生成 Wiki 时的入口。
 */

import { Box, Text } from 'ink';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Logo } from './Logo.js';
import { SelectMenu } from './SelectMenu.js';
import type { TuiBase } from '../types.js';

interface Props {
    base: TuiBase;
    isActive: boolean;
    onGenerate: () => void;
    onExit: () => void;
}

export function FirstRunScreen({ base, isActive, onGenerate, onExit }: Props) {
    const { columns, rows } = useTerminalSize();
    return (
        <Box flexDirection="column" paddingX={2} paddingY={1} flexGrow={1}>
            <Logo width={columns - 4} height={rows - 10} />
            <Box marginTop={1}>
                <Text>
                    当前项目还没有生成 Wiki: <Text dimColor>{base.workspacePath}</Text>
                </Text>
            </Box>
            <Box marginTop={1} flexDirection="column">
                <SelectMenu
                    isActive={isActive}
                    items={[
                        { label: '生成 Wiki', value: 'generate', hint: `lang: ${base.lang}` },
                        { label: '退出', value: 'exit' },
                    ]}
                    onSelect={(v) => (v === 'generate' ? onGenerate() : onExit())}
                    onCancel={onExit}
                />
            </Box>
            <Box marginTop={1}>
                <Text dimColor>生成会在本地扫描分析代码；使用大模型时上传项目结构、模块摘要与被引用的源码片段。</Text>
            </Box>
        </Box>
    );
}
