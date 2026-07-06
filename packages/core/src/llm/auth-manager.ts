/**
 * @module auth-manager
 * @description 管理 LLM API 凭证，支持多来源优先级链解析配置。
 *
 * 优先级链（按优先级从高到低）：
 * 1. 环境变量: REPOWIKI_API_KEY, REPOWIKI_BASE_URL, REPOWIKI_MODEL
 * 2. 环境变量 (OpenAI 兼容): OPENAI_API_KEY, OPENAI_BASE_URL
 * 3. 全局配置文件: ~/.repowiki/config.json
 * 4. 工作区 .env 文件（使用 dotenv 解析）
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

// ============================================================================
// 类型定义
// ============================================================================

/** LLM 服务配置 */
export interface LLMConfig {
    /** API 端点地址 */
    apiEndpoint: string;
    /** 模型名称 */
    modelName: string;
    /** API 密钥 */
    apiKey: string;
}

// ============================================================================
// 常量
// ============================================================================

/** 默认 API 端点 */
const DEFAULT_API_ENDPOINT = 'https://api.openai.com/v1';

/** 默认模型名称 */
const DEFAULT_MODEL_NAME = 'gpt-4o';

/** 全局配置目录名 */
const GLOBAL_CONFIG_DIR = '.repowiki';

/** 全局配置文件名 */
const GLOBAL_CONFIG_FILE = 'config.json';

// ============================================================================
// 内部工具函数
// ============================================================================

/**
 * 获取全局配置文件的绝对路径
 */
function getGlobalConfigPath(): string {
    return path.join(os.homedir(), GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_FILE);
}

/**
 * 尝试读取并解析 JSON 配置文件，若文件不存在或解析失败则返回空对象
 */
async function readJsonConfig(filePath: string): Promise<Record<string, unknown>> {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed: unknown = JSON.parse(content);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return {};
    } catch {
        // 文件不存在或内容无效，均视为空配置
        return {};
    }
}

/**
 * 尝试解析工作区 .env 文件，返回解析后的键值对
 */
async function readWorkspaceEnv(workspacePath: string): Promise<Record<string, string>> {
    const envFilePath = path.join(workspacePath, '.env');
    try {
        const content = await fs.readFile(envFilePath, 'utf-8');
        const parsed = dotenv.parse(content);
        return parsed;
    } catch {
        return {};
    }
}

/**
 * 返回第一个非空字符串值，若全部为空则返回 undefined
 */
function firstNonEmpty(...values: Array<string | undefined | null>): string | undefined {
    for (const v of values) {
        if (v && v.trim().length > 0) {
            return v.trim();
        }
    }
    return undefined;
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 按优先级链加载 LLM 配置。
 *
 * 解析顺序：
 * 1. 进程环境变量（REPOWIKI_* 优先，其次 OPENAI_*）
 * 2. 全局配置文件 ~/.repowiki/config.json
 * 3. 工作区 .env 文件
 *
 * 对于每个字段，取优先级最高的非空值；若全部为空则使用默认值或空字符串。
 *
 * @param workspacePath - 可选的工作区路径，用于读取 .env 文件
 * @returns 解析后的 LLM 配置
 */
export async function loadLLMConfig(workspacePath?: string): Promise<LLMConfig> {
    // --- 来源 1 & 2: 环境变量（已在 process.env 中） ---
    const envApiKey = firstNonEmpty(process.env['REPOWIKI_API_KEY'], process.env['OPENAI_API_KEY']);
    const envEndpoint = firstNonEmpty(process.env['REPOWIKI_BASE_URL'], process.env['OPENAI_BASE_URL']);
    const envModel = firstNonEmpty(process.env['REPOWIKI_MODEL']);

    // --- 来源 3: 全局配置文件 ---
    const globalConfig = await readJsonConfig(getGlobalConfigPath());
    const globalApiKey = typeof globalConfig['apiKey'] === 'string' ? globalConfig['apiKey'] : undefined;
    const globalEndpoint = typeof globalConfig['apiEndpoint'] === 'string' ? globalConfig['apiEndpoint'] : undefined;
    const globalModel = typeof globalConfig['modelName'] === 'string' ? globalConfig['modelName'] : undefined;

    // --- 来源 4: 工作区 .env ---
    let wsApiKey: string | undefined;
    let wsEndpoint: string | undefined;
    let wsModel: string | undefined;
    if (workspacePath) {
        const wsEnv = await readWorkspaceEnv(workspacePath);
        wsApiKey = firstNonEmpty(wsEnv['REPOWIKI_API_KEY'], wsEnv['OPENAI_API_KEY']);
        wsEndpoint = firstNonEmpty(wsEnv['REPOWIKI_BASE_URL'], wsEnv['OPENAI_BASE_URL']);
        wsModel = firstNonEmpty(wsEnv['REPOWIKI_MODEL']);
    }

    // --- 合并：对每个字段，按优先级取第一个非空值 ---
    const apiKey = firstNonEmpty(envApiKey, globalApiKey, wsApiKey) ?? '';
    const apiEndpoint = firstNonEmpty(envEndpoint, globalEndpoint, wsEndpoint) ?? DEFAULT_API_ENDPOINT;
    const modelName = firstNonEmpty(envModel, globalModel, wsModel) ?? DEFAULT_MODEL_NAME;

    return { apiEndpoint, modelName, apiKey };
}

/**
 * 将配置保存到全局配置文件 ~/.repowiki/config.json。
 *
 * 如果文件已存在，则与现有配置合并（新值覆盖旧值）。
 * 如果目录不存在，则自动创建。
 *
 * @param config - 要保存的部分配置
 */
export async function saveGlobalConfig(config: Partial<LLMConfig>): Promise<void> {
    const configPath = getGlobalConfigPath();
    const configDir = path.dirname(configPath);

    // 确保配置目录存在
    await fs.mkdir(configDir, { recursive: true });

    // 读取现有配置并合并
    const existing = await readJsonConfig(configPath);

    // 仅合并非 undefined 的字段
    const merged: Record<string, unknown> = { ...existing };
    if (config.apiEndpoint !== undefined) merged['apiEndpoint'] = config.apiEndpoint;
    if (config.modelName !== undefined) merged['modelName'] = config.modelName;
    if (config.apiKey !== undefined) merged['apiKey'] = config.apiKey;

    await fs.writeFile(configPath, JSON.stringify(merged, null, 2), 'utf-8');

    // 配置文件含明文 API key，POSIX 上收紧为仅属主可读写（Windows 无此语义，忽略）
    if (process.platform !== 'win32') {
        try {
            await fs.chmod(configDir, 0o700);
            await fs.chmod(configPath, 0o600);
        } catch {
            // 权限收紧失败不阻塞保存
        }
    }
}

/**
 * 验证 LLM 配置的完整性。
 *
 * @param config - 待验证的配置
 * @returns 错误消息数组。若为空数组，则配置有效。
 */
export function validateConfig(config: LLMConfig): string[] {
    const errors: string[] = [];

    if (!config.apiKey || config.apiKey.trim().length === 0) {
        errors.push('缺少 API 密钥 (apiKey)。请通过环境变量 REPOWIKI_API_KEY 或全局配置文件设置。');
    }

    if (!config.apiEndpoint || config.apiEndpoint.trim().length === 0) {
        errors.push('缺少 API 端点 (apiEndpoint)。');
    }

    if (!config.modelName || config.modelName.trim().length === 0) {
        errors.push('缺少模型名称 (modelName)。');
    }

    // 验证 apiEndpoint 是合法 URL
    if (config.apiEndpoint && config.apiEndpoint.trim().length > 0) {
        try {
            new URL(config.apiEndpoint);
        } catch {
            errors.push(`API 端点格式无效: "${config.apiEndpoint}"。请提供合法的 URL。`);
        }
    }

    return errors;
}
