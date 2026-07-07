/**
 * RepoWiki ASCII 字标（纯 ASCII，conhost 安全）。
 * 空间不足时退化为单行文字。
 */

import { Box, Text } from 'ink';

const LOGO_LINES = [
    String.raw` ____                     __        ___ _    _`,
    String.raw`|  _ \ ___ _ __   ___     \ \      / (_) | _(_)`,
    String.raw`| |_) / _ \ '_ \ / _ \     \ \ /\ / /| | |/ / |`,
    String.raw`|  _ <  __/ |_) | (_) |     \ V  V / | |   <| |`,
    String.raw`|_| \_\___| .__/ \___/       \_/\_/  |_|_|\_\_|`,
    String.raw`          |_|`,
];

const LOGO_WIDTH = 48;
const TAGLINE = '本地代码库 Wiki · 问答 · 溯源';

interface Props {
    /** 可用宽度（列） */
    width: number;
    /** 可用高度（行） */
    height: number;
    showTagline?: boolean;
}

export function Logo({ width, height, showTagline = true }: Props) {
    if (width < LOGO_WIDTH + 2 || height < LOGO_LINES.length + 3) {
        return (
            <Text bold color="cyan">
                RepoWiki {showTagline ? <Text dimColor>— {TAGLINE}</Text> : null}
            </Text>
        );
    }
    return (
        <Box flexDirection="column">
            {LOGO_LINES.map((line, i) => (
                <Text key={i} color="cyan">
                    {line}
                </Text>
            ))}
            {showTagline ? <Text dimColor>  {TAGLINE}</Text> : null}
        </Box>
    );
}
