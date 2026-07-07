/**
 * 跨平台"打开源码到指定行"：优先 VS Code（code -g path:line），
 * 其次 $VISUAL/$EDITOR 指向的 GUI 编辑器；都不可用时返回路径供用户复制。
 * 终端编辑器（vim/nano 等）会与 ink 抢 TTY，一律不启动。
 */

import { spawn } from 'node:child_process';

export interface OpenResult {
    ok: boolean;
    message: string;
}

const GUI_EDITOR_PATTERN = /(code|codium|cursor|zed|subl|sublime|atom|notepad|webstorm|idea)/i;

function trySpawn(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
        const isWin = process.platform === 'win32';
        // Windows 上 code 是 code.cmd，需经 shell 解析；shell 模式下手动引号防空格路径
        const child = isWin
            ? spawn(`${command} ${args.map((a) => `"${a}"`).join(' ')}`, { stdio: 'ignore', shell: true })
            : spawn(command, args, { stdio: 'ignore' });
        let settled = false;
        const settle = (ok: boolean): void => {
            if (!settled) {
                settled = true;
                resolve(ok);
            }
        };
        child.on('error', () => settle(false));
        // code CLI 把打开动作转交常驻实例后立即退出；非 0 退出码视为失败
        child.on('exit', (exitCode) => settle(exitCode === 0));
        // 兜底：3 秒未退出按已成功处理（某些编辑器 CLI 会常驻）
        setTimeout(() => settle(true), 3000).unref?.();
    });
}

export async function openInEditor(absPath: string, line?: number): Promise<OpenResult> {
    const target = line ? `${absPath}:${line}` : absPath;

    if (await trySpawn('code', ['-g', target])) {
        return { ok: true, message: `已在 VS Code 打开 ${target}` };
    }

    const editor = process.env['VISUAL'] || process.env['EDITOR'] || '';
    if (editor && GUI_EDITOR_PATTERN.test(editor)) {
        if (await trySpawn(editor, [absPath])) {
            return { ok: true, message: `已用 ${editor} 打开 ${absPath}` };
        }
    }

    return { ok: false, message: `无法启动编辑器，路径: ${target}` };
}
