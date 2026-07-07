/**
 * 生成/更新进度屏：驱动 runPipeline 并渲染 PROGRESS/WARN 流。
 * 完成后由 App 重载 wiki 数据回主界面；失败按 Esc 返回。
 */

import { useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { runPipeline } from 'repowiki-core';
import type { Action, GenerateState } from '../state.js';
import type { TuiBase } from '../types.js';

interface Props {
    base: TuiBase;
    generate: GenerateState;
    dispatch: (action: Action) => void;
    onComplete: () => void;
    onAbort: () => void;
}

function bar(progress: number, width = 20): string {
    const filled = Math.round((Math.max(0, Math.min(100, progress)) / 100) * width);
    return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
}

export function GenerateScreen({ base, generate, dispatch, onComplete, onAbort }: Props) {
    const startedRef = useRef(false);
    const completedRef = useRef(false);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        void (async () => {
            try {
                await runPipeline({
                    workspacePath: base.workspacePath,
                    lang: base.lang,
                    forceRebuild: generate.opts.forceRebuild,
                    skipLlm: generate.opts.skipLlm,
                    onProgress: (event) => dispatch({ type: 'PIPELINE_EVENT', event }),
                });
            } catch (err: unknown) {
                // runPipeline 已 emit ERROR 后 rethrow；reducer 对重复 ERROR 去重
                const message = err instanceof Error ? err.message : String(err);
                dispatch({ type: 'PIPELINE_EVENT', event: { type: 'ERROR', code: 1, message } });
            }
        })();
    }, []);

    useEffect(() => {
        if (generate.done && !completedRef.current) {
            completedRef.current = true;
            onComplete();
        }
    }, [generate.done]);

    useInput(
        (_input, key) => {
            if (key.escape && generate.error) onAbort();
        },
        { isActive: Boolean(generate.error) },
    );

    const title = generate.opts.forceRebuild
        ? '全量重建 Wiki'
        : generate.opts.skipLlm
          ? '生成 Wiki（离线模式）'
          : '生成 / 更新 Wiki';

    return (
        <Box flexDirection="column" paddingX={2} paddingY={1} flexGrow={1}>
            <Text bold color="cyan">
                {title}  <Text dimColor>lang: {base.lang}</Text>
            </Text>
            <Box flexDirection="column" marginTop={1}>
                {generate.stageOrder.map((stage) => {
                    const s = generate.stages[stage];
                    return (
                        <Text key={stage}>
                            <Text color="green">{bar(s.progress)}</Text> {String(s.progress).padStart(3)}%  {stage}  <Text dimColor>{s.message}</Text>
                        </Text>
                    );
                })}
            </Box>
            {generate.warns.length > 0 ? (
                <Box flexDirection="column" marginTop={1}>
                    {generate.warns.slice(-5).map((w, i) => (
                        <Text key={i} color="yellow" dimColor>
                            warn: {w}
                        </Text>
                    ))}
                </Box>
            ) : null}
            {generate.error ? (
                <Box flexDirection="column" marginTop={1}>
                    <Text color="red">生成失败: {generate.error}</Text>
                    <Text dimColor>按 Esc 返回</Text>
                </Box>
            ) : null}
            {generate.done ? <Text color="green">生成完成，正在加载...</Text> : null}
        </Box>
    );
}
