/**
 * @module git
 * @description 轻量 git 封装（用于元数据与增量更新的快路）。
 * 全部调用在非 git 仓库或 git 缺失时安全降级为 null。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** git 变更状态 */
export interface GitChange {
    status: 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | string;
    path: string;
    /** 重命名/复制时的旧路径 */
    oldPath?: string;
}

/**
 * 运行 git 命令，失败返回 null。
 */
async function runGit(cwd: string, args: string[]): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
        return stdout;
    } catch {
        return null;
    }
}

/**
 * 获取当前 HEAD 的完整 SHA；非 git 仓库返回 null。
 */
export async function getGitCommit(cwd: string): Promise<string | null> {
    const out = await runGit(cwd, ['rev-parse', 'HEAD']);
    return out ? out.trim() : null;
}

/**
 * `git diff --name-status <fromSha> HEAD` 解析为 GitChange[]；失败返回 null。
 */
export async function gitDiffNameStatus(cwd: string, fromSha: string): Promise<GitChange[] | null> {
    const out = await runGit(cwd, ['diff', '--name-status', fromSha, 'HEAD']);
    if (out === null) return null;
    return parseNameStatus(out);
}

/**
 * `git status --porcelain -uall` 解析为 GitChange[]（含未提交改动）；失败返回 null。
 * -uall 展开未跟踪目录内的具体文件（默认会折叠成 `dir/`，导致新增文件漏报）。
 */
export async function gitStatusPorcelain(cwd: string): Promise<GitChange[] | null> {
    const out = await runGit(cwd, ['status', '--porcelain', '-uall']);
    if (out === null) return null;
    const changes: GitChange[] = [];
    for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        // 形如: `XY path` 或 `R  old -> new`
        const x = line[0];
        const y = line[1];
        const rest = line.slice(3).trim();
        const code = (x !== ' ' && x !== '?' ? x : y) || 'M';
        if (rest.includes(' -> ')) {
            const [oldPath, newPath] = rest.split(' -> ');
            changes.push({ status: 'R', path: newPath.trim(), oldPath: oldPath.trim() });
        } else {
            const status = code === '?' ? 'A' : code;
            changes.push({ status, path: rest });
        }
    }
    return changes;
}

/** 解析 `--name-status` 输出 */
function parseNameStatus(out: string): GitChange[] {
    const changes: GitChange[] = [];
    for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        const code = parts[0];
        if (code.startsWith('R') || code.startsWith('C')) {
            // R100  old  new
            changes.push({ status: code[0], path: parts[2], oldPath: parts[1] });
        } else {
            changes.push({ status: code[0], path: parts[1] });
        }
    }
    return changes;
}
