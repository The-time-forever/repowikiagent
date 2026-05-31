import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileNode } from '../models/index.js';

export interface ConfigInfo {
    filePath: string;
    type: 'env' | 'yaml' | 'json' | 'toml' | 'dockerfile' | 'ci' | 'js_ts';
    keys: string[];
    description: string;
}

/**
 * 判断是否为配置文件，并归类其类型
 */
function detectConfigType(relativePath: string): 'env' | 'yaml' | 'json' | 'toml' | 'dockerfile' | 'ci' | 'js_ts' | null {
    const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
    const basename = path.basename(normalized);

    if (normalized.startsWith('.github/workflows/')) {
        return 'ci';
    }
    if (basename === 'dockerfile' || basename.startsWith('dockerfile.')) {
        return 'dockerfile';
    }
    if (basename.startsWith('.env')) {
        return 'env';
    }
    if (basename.endsWith('.json')) {
        return 'json';
    }
    if (basename.endsWith('.toml')) {
        return 'toml';
    }
    if (basename.endsWith('.yaml') || basename.endsWith('.yml')) {
        return 'yaml';
    }
    if (
        basename.endsWith('config.js') ||
        basename.endsWith('config.ts') ||
        basename.endsWith('config.mjs') ||
        basename.endsWith('config.cjs')
    ) {
        return 'js_ts';
    }

    return null;
}

/**
 * 解析各种配置文件中的配置键/节
 */
async function parseConfigFiles(absolutePath: string, type: string, content: string): Promise<{ keys: string[]; description: string }> {
    const keys: string[] = [];
    let description = '';

    try {
        switch (type) {
            case 'env': {
                description = '环境变量模板/配置文件';
                const lines = content.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) continue;
                    const match = /^export\s+(\w+)=|^(\w+)=/.exec(trimmed);
                    if (match) {
                        const key = match[1] || match[2];
                        if (key) keys.push(key);
                    }
                }
                break;
            }
            case 'json': {
                description = 'JSON 格式配置文件';
                try {
                    // 去除 JSON 的注释（如果有的话，如 tsconfig.json）
                    const cleanJson = content.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
                    const parsed = JSON.parse(cleanJson);
                    if (parsed && typeof parsed === 'object') {
                        keys.push(...Object.keys(parsed));
                    }
                } catch {
                    // 解析失败时，回退到正则
                    const keyPattern = /"([^"]+)"\s*:/g;
                    let match: RegExpExecArray | null;
                    while ((match = keyPattern.exec(content)) !== null) {
                        if (!keys.includes(match[1])) {
                            keys.push(match[1]);
                        }
                    }
                }
                break;
            }
            case 'yaml':
            case 'ci': {
                description = type === 'ci' ? 'GitHub 工作流持续集成配置' : 'YAML 格式配置文件';
                const lines = content.split('\n');
                for (const line of lines) {
                    const match = /^([a-zA-Z0-9_\-]+)\s*:/gm.exec(line);
                    if (match) {
                        const key = match[1];
                        if (!keys.includes(key)) {
                            keys.push(key);
                        }
                    }
                }
                break;
            }
            case 'toml': {
                description = 'TOML 格式配置文件';
                const lines = content.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                        const section = trimmed.slice(1, -1).trim();
                        keys.push(section);
                    } else {
                        const match = /^([a-zA-Z0-9_\-]+)\s*=/.exec(trimmed);
                        if (match) {
                            keys.push(match[1]);
                        }
                    }
                }
                break;
            }
            case 'dockerfile': {
                description = 'Docker 容器构建文件';
                const lines = content.split('\n');
                const envKeys = new Set<string>();
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('FROM')) {
                        const parts = trimmed.split(/\s+/);
                        if (parts[1]) keys.push(`BaseImage: ${parts[1]}`);
                    } else if (trimmed.startsWith('ENV')) {
                        // ENV KEY=VALUE 或 ENV KEY VALUE
                        const match = /^ENV\s+(\w+)(?:=|\s+)/.exec(trimmed);
                        if (match && match[1]) {
                            envKeys.add(match[1]);
                        }
                    } else if (trimmed.startsWith('EXPOSE')) {
                        const parts = trimmed.split(/\s+/);
                        if (parts[1]) keys.push(`ExposePort: ${parts[1]}`);
                    }
                }
                if (envKeys.size > 0) {
                    keys.push(...Array.from(envKeys).map(k => `ENV: ${k}`));
                }
                break;
            }
            case 'js_ts': {
                description = 'JavaScript/TypeScript 构建/运行时配置文件';
                // 查找默认导出的对象键或 module.exports
                const exportMatch = /export\s+default\s*\{([\s\S]*?)\}/.exec(content) || 
                                    /module\.exports\s*=\s*\{([\s\S]*?)\}/.exec(content);
                if (exportMatch) {
                    const block = exportMatch[1];
                    const keyPattern = /^\s*(\w+)\s*:/gm;
                    let match: RegExpExecArray | null;
                    while ((match = keyPattern.exec(block)) !== null) {
                        keys.push(match[1]);
                    }
                }
                break;
            }
        }
    } catch {
        // 解析出错则返回空 keys
    }

    return { keys: Array.from(new Set(keys)), description };
}

/**
 * 分析项目中的配置文件和环境配置
 *
 * 识别 docker-compose, tsconfig, env.example, *.config.js 等文件，
 * 提取顶层配置键、工作流阶段或环境变量，以便 Wiki 文档生成时使用。
 *
 * @param rootPath - 项目根目录
 * @param files - 扫描的文件节点
 */
export async function analyzeConfigs(rootPath: string, files: FileNode[]): Promise<ConfigInfo[]> {
    const configInfos: ConfigInfo[] = [];

    for (const file of files) {
        if (file.nodeType !== 'file') continue;

        const type = detectConfigType(file.relativePath);
        if (!type) continue;

        try {
            const absolutePath = path.resolve(rootPath, file.relativePath);
            const content = await fs.readFile(absolutePath, 'utf-8');
            const { keys, description } = await parseConfigFiles(absolutePath, type, content);

            configInfos.push({
                filePath: file.relativePath,
                type,
                keys,
                description,
            });
        } catch {
            // 忽略读取失败的文件
        }
    }

    // 排序，保证生成文档的顺序一致
    return configInfos.sort((a, b) => a.filePath.localeCompare(b.filePath));
}
