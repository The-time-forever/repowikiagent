/**
 * @module prompt
 * @description 终端输入工具：掩码密钥输入与密钥脱敏显示。
 * 手写 raw mode 掩码而非引入交互库，与项目最小依赖风格一致（参见 core 的 concurrency.ts）。
 */

import { stdin, stdout } from 'node:process';

const CTRL_C = String.fromCharCode(0x03);
const BACKSPACE_DEL = String.fromCharCode(0x7f);

/**
 * 密钥脱敏显示：保留头 6 位与尾 4 位，中间以 ... 代替。
 * 过短的密钥全部以 * 显示，避免变相泄露。
 */
export function maskKey(key: string): string {
    if (key.length <= 12) {
        return '*'.repeat(key.length);
    }
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

/**
 * 掩码读取一行敏感输入：回显 *，支持退格；Ctrl+C 退出进程。
 * stdin 非 TTY（管道/重定向）时退化为读取一行明文，便于脚本化使用。
 */
export function promptSecret(promptText: string): Promise<string> {
    if (!stdin.isTTY) {
        return readLineFromStdin(promptText);
    }

    return new Promise((resolve) => {
        stdout.write(promptText);
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf-8');

        let value = '';

        const finish = (result: string) => {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener('data', onData);
            stdout.write('\n');
            resolve(result);
        };

        const onData = (chunk: string) => {
            for (const ch of chunk) {
                if (ch === '\r' || ch === '\n') {
                    finish(value);
                    return;
                }
                if (ch === CTRL_C) {
                    stdin.setRawMode(false);
                    stdout.write('\n');
                    process.exit(130);
                }
                if (ch === BACKSPACE_DEL || ch === '\b') {
                    if (value.length > 0) {
                        value = value.slice(0, -1);
                        stdout.write('\b \b');
                    }
                    continue;
                }
                // 忽略其他控制字符（方向键等 ESC 序列）
                if (ch >= ' ') {
                    value += ch;
                    stdout.write('*');
                }
            }
        };

        stdin.on('data', onData);
    });
}

/** 从非 TTY stdin 读取一行（去除结尾换行与空白） */
function readLineFromStdin(promptText: string): Promise<string> {
    if (promptText) stdout.write(promptText);
    return new Promise((resolve) => {
        let data = '';
        stdin.setEncoding('utf-8');
        stdin.on('data', (chunk: string) => {
            data += chunk;
            const nl = data.indexOf('\n');
            if (nl >= 0) {
                stdin.pause();
                resolve(data.slice(0, nl).trim());
            }
        });
        stdin.on('end', () => resolve(data.trim()));
    });
}
