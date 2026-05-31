/**
 * @module llm-client
 * @description OpenAI 兼容的 LLM API 客户端。
 *
 * 特性:
 * - 使用原生 fetch (Node 18+)
 * - 指数退避重试 (429 / 5xx)
 * - AbortController 超时控制
 * - chatJSON: 自动解析 JSON 响应并可选 Zod 校验
 */

import { z } from 'zod';
import type { LLMConfig } from './auth-manager.js';

// ============================================================================
// 类型定义
// ============================================================================

/** 聊天消息 */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/** LLM 客户端选项 */
export interface LLMClientOptions {
    /** LLM 服务配置 */
    config: LLMConfig;
    /** 最大重试次数 (默认 3) */
    maxRetries?: number;
    /** 基础重试延迟，毫秒 (默认 1000) */
    retryDelayMs?: number;
    /** 请求超时，毫秒 (默认 120000，即 2 分钟) */
    timeoutMs?: number;
}

/** LLM 响应 */
export interface LLMResponse {
    /** 模型回复的文本内容 */
    content: string;
    /** Token 使用统计 */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

/** chat 方法可选参数 */
export interface ChatOptions {
    /** 温度，控制随机性 (默认 0.3) */
    temperature?: number;
    /** 最大生成 token 数 */
    maxTokens?: number;
}

// ============================================================================
// 错误类
// ============================================================================

/** LLM 请求错误基类 */
export class LLMError extends Error {
    constructor(
        message: string,
        public readonly statusCode?: number,
        public readonly responseBody?: string,
    ) {
        super(message);
        this.name = 'LLMError';
    }
}

/** 认证错误 (401 / 403) */
export class LLMAuthError extends LLMError {
    constructor(message: string, statusCode: number, responseBody?: string) {
        super(message, statusCode, responseBody);
        this.name = 'LLMAuthError';
    }
}

/** 速率限制错误 (429) */
export class LLMRateLimitError extends LLMError {
    constructor(message: string, responseBody?: string) {
        super(message, 429, responseBody);
        this.name = 'LLMRateLimitError';
    }
}

/** JSON 解析错误 */
export class LLMJsonParseError extends LLMError {
    constructor(
        message: string,
        public readonly rawContent: string,
    ) {
        super(message);
        this.name = 'LLMJsonParseError';
    }
}

// ============================================================================
// 内部工具函数
// ============================================================================

/** 可重试的 HTTP 状态码 */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

/**
 * 延迟指定毫秒
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 尝试从 Markdown 代码块中提取 JSON 字符串。
 * 匹配 ```json ... ``` 或 ``` ... ``` 格式。
 */
function extractJsonFromMarkdown(text: string): string | null {
    // 匹配 ```json\n...\n``` 或 ```\n...\n```
    const fencePattern = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/;
    const match = text.match(fencePattern);
    if (match?.[1]) {
        return match[1].trim();
    }
    return null;
}

/**
 * 尝试解析 JSON 字符串，失败时尝试从 Markdown 代码块中提取再解析。
 */
function parseJsonSafe(text: string): unknown {
    // 首先直接尝试解析
    try {
        return JSON.parse(text);
    } catch {
        // 尝试从代码块提取
        const extracted = extractJsonFromMarkdown(text);
        if (extracted) {
            return JSON.parse(extracted);
        }
        throw new Error(`无法解析 JSON 内容`);
    }
}

// ============================================================================
// LLMClient 类
// ============================================================================

/**
 * OpenAI 兼容的 LLM 客户端。
 *
 * @example
 * ```ts
 * const client = new LLMClient({ config });
 * const response = await client.chat([
 *     { role: 'system', content: '你是一个助手。' },
 *     { role: 'user', content: '你好' },
 * ]);
 * console.log(response.content);
 * ```
 */
export class LLMClient {
    private readonly config: LLMConfig;
    private readonly maxRetries: number;
    private readonly retryDelayMs: number;
    private readonly timeoutMs: number;

    constructor(options: LLMClientOptions) {
        this.config = options.config;
        this.maxRetries = options.maxRetries ?? 3;
        this.retryDelayMs = options.retryDelayMs ?? 1000;
        this.timeoutMs = options.timeoutMs ?? 120_000;
    }

    /**
     * 发送聊天补全请求。
     *
     * @param messages - 聊天消息列表
     * @param options  - 可选参数（温度、最大 token 数）
     * @returns LLM 响应
     * @throws {LLMAuthError} 认证失败
     * @throws {LLMRateLimitError} 速率限制（重试耗尽后）
     * @throws {LLMError} 其他请求错误
     */
    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
        const url = `${this.config.apiEndpoint.replace(/\/+$/, '')}/chat/completions`;
        const body = this.buildRequestBody(messages, options);

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            // 非首次请求时等待（指数退避）
            if (attempt > 0) {
                const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
                await sleep(delay);
            }

            try {
                const response = await this.fetchWithTimeout(url, body);
                return this.parseResponse(response);
            } catch (error) {
                lastError = error as Error;

                // 认证错误不重试
                if (error instanceof LLMAuthError) {
                    throw error;
                }

                // 非可重试错误不重试
                if (error instanceof LLMError && error.statusCode && !RETRYABLE_STATUS_CODES.has(error.statusCode)) {
                    throw error;
                }

                // 最后一次重试仍然失败
                if (attempt === this.maxRetries) {
                    break;
                }
            }
        }

        // 重试耗尽
        throw lastError ?? new LLMError('LLM 请求失败: 未知错误');
    }

    /**
     * 发送聊天请求并将响应解析为 JSON。
     *
     * 工作流程:
     * 1. 调用 chat() 获取文本响应
     * 2. 尝试解析 JSON（支持从 Markdown 代码块中提取）
     * 3. 若提供了 Zod schema，进行运行时校验
     * 4. 若 JSON 解析失败，追加修正提示后重试一次
     *
     * @param messages - 聊天消息列表
     * @param schema   - 可选的 Zod 校验 schema
     * @returns 解析后的 JSON 对象
     * @throws {LLMJsonParseError} JSON 解析或校验失败
     */
    async chatJSON<T = unknown>(messages: ChatMessage[], schema?: z.ZodType<T>): Promise<T> {
        // 第一次尝试
        const response = await this.chat(messages);

        try {
            return this.validateJsonResponse<T>(response.content, schema);
        } catch (firstError) {
            // JSON 解析或校验失败，追加修正提示后重试
            const fixMessages: ChatMessage[] = [
                ...messages,
                { role: 'assistant', content: response.content },
                {
                    role: 'user',
                    content:
                        '你上次的回复不是合法的 JSON 格式。请严格按照要求只输出合法的 JSON，' +
                        '不要在 JSON 前后添加任何额外文字或 Markdown 格式标记。' +
                        (firstError instanceof Error ? `\n错误信息: ${firstError.message}` : ''),
                },
            ];

            const retryResponse = await this.chat(fixMessages);

            try {
                return this.validateJsonResponse<T>(retryResponse.content, schema);
            } catch (secondError) {
                throw new LLMJsonParseError(
                    `JSON 解析失败（已重试）: ${secondError instanceof Error ? secondError.message : '未知错误'}`,
                    retryResponse.content,
                );
            }
        }
    }

    // ========================================================================
    // 私有方法
    // ========================================================================

    /**
     * 构建 OpenAI 兼容的请求体
     */
    private buildRequestBody(messages: ChatMessage[], options?: ChatOptions): string {
        const payload: Record<string, unknown> = {
            model: this.config.modelName,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            temperature: options?.temperature ?? 0.3,
        };

        if (options?.maxTokens !== undefined) {
            payload['max_tokens'] = options.maxTokens;
        }

        return JSON.stringify(payload);
    }

    /**
     * 带超时控制的 fetch 请求
     */
    private async fetchWithTimeout(url: string, body: string): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body,
                signal: controller.signal,
            });

            // 处理错误状态码
            if (!response.ok) {
                const responseBody = await response.text().catch(() => '');
                this.handleErrorStatus(response.status, responseBody);
            }

            return response;
        } catch (error) {
            if (error instanceof LLMError) {
                throw error;
            }

            if (error instanceof DOMException && error.name === 'AbortError') {
                throw new LLMError(`请求超时 (${this.timeoutMs}ms)`);
            }

            throw new LLMError(
                `网络请求失败: ${error instanceof Error ? error.message : '未知错误'}`,
            );
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * 根据 HTTP 状态码抛出对应错误
     */
    private handleErrorStatus(status: number, responseBody: string): never {
        // 尝试从响应体中提取错误消息
        let detail = '';
        try {
            const parsed = JSON.parse(responseBody) as { error?: { message?: string } };
            detail = parsed?.error?.message ?? '';
        } catch {
            detail = responseBody.slice(0, 200);
        }

        if (status === 401 || status === 403) {
            throw new LLMAuthError(
                `认证失败 (HTTP ${status}): ${detail || 'API 密钥无效或已过期'}`,
                status,
                responseBody,
            );
        }

        if (status === 429) {
            throw new LLMRateLimitError(
                `请求速率超限 (HTTP 429): ${detail || '请稍后重试'}`,
                responseBody,
            );
        }

        throw new LLMError(
            `API 请求失败 (HTTP ${status}): ${detail || '未知错误'}`,
            status,
            responseBody,
        );
    }

    /**
     * 从 OpenAI 兼容响应中解析内容和 usage
     */
    private async parseResponse(response: Response): Promise<LLMResponse> {
        const json = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
            };
        };

        const content = json.choices?.[0]?.message?.content ?? '';

        const result: LLMResponse = { content };

        if (json.usage) {
            result.usage = {
                promptTokens: json.usage.prompt_tokens ?? 0,
                completionTokens: json.usage.completion_tokens ?? 0,
                totalTokens: json.usage.total_tokens ?? 0,
            };
        }

        return result;
    }

    /**
     * 验证 JSON 响应：解析 + 可选 Zod 校验
     */
    private validateJsonResponse<T>(content: string, schema?: z.ZodType<T>): T {
        const parsed = parseJsonSafe(content);

        if (schema) {
            const result = schema.safeParse(parsed);
            if (!result.success) {
                const issues = result.error.issues
                    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
                    .join('\n');
                throw new Error(`JSON 数据校验失败:\n${issues}`);
            }
            return result.data;
        }

        return parsed as T;
    }
}
