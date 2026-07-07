/**
 * 终端尺寸 hook：resize 时触发重渲染，各面板据此重算开窗高度。
 */

import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

export interface TerminalSize {
    columns: number;
    rows: number;
}

export function useTerminalSize(): TerminalSize {
    const { stdout } = useStdout();
    const [size, setSize] = useState<TerminalSize>({
        columns: stdout.columns || 80,
        rows: stdout.rows || 24,
    });

    useEffect(() => {
        const onResize = (): void => {
            setSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
        };
        stdout.on('resize', onResize);
        return () => {
            stdout.off('resize', onResize);
        };
    }, [stdout]);

    return size;
}
