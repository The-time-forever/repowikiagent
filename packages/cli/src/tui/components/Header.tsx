/**
 * 顶栏：项目名 / 语言 / 生成时 commit 短哈希。
 */

import * as path from 'node:path';
import { Box, Text } from 'ink';
import type { LoadedWiki, TuiBase } from '../types.js';

interface Props {
    base: TuiBase;
    data: LoadedWiki | null;
}

export function Header({ base, data }: Props) {
    const commit = data?.metadata.generated_at_commit;
    return (
        <Box paddingX={1} justifyContent="space-between">
            <Text bold color="cyan">
                RepoWiki  <Text color="white">{path.basename(base.workspacePath)}</Text>
            </Text>
            <Text dimColor>
                Lang: {base.lang}
                {commit ? `  @${commit.slice(0, 7)}` : ''}
            </Text>
        </Box>
    );
}
