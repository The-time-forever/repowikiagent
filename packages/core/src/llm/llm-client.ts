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
    /**
     * 请求超时，毫秒 (默认 300000，即 5 分钟)。
     * 流式模式下为**空闲超时**（相邻数据块间隔上限）；非流式为整体超时。
     */
    timeoutMs?: number;
    /** 使用流式响应 (默认 true)；端点不支持时自动降级非流式 */
    streaming?: boolean;
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

/** 客户端累计用量 */
export interface UsageTotals {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** 成功的 LLM 调用次数 */
    calls: number;
}

/** chat 方法可选参数 */
export interface ChatOptions {
    /** 温度，控制随机性 (默认 0.3) */
    temperature?: number;
    /** 最大生成 token 数 */
    maxTokens?: number;
    /** 流式增量回调：每收到一段内容触发一次（仅流式模式；显示用途，最终完整内容以返回值为准） */
    onToken?: (delta: string) => void;
    /** 流式中断重试时触发：消费方应清空已展示的部分内容 */
    onStreamReset?: () => void;
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
    private readonly streaming: boolean;
    /** 本客户端生命周期内的累计用量（chatJSON/chatWithValidation 均经由 chat，单点累计） */
    private readonly usageTotals: UsageTotals = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        calls: 0,
    };

    /** 端点确认不支持流式后置位，后续调用直接走非流式 */
    private streamingDisabled = false;

    constructor(options: LLMClientOptions) {
        this.config = options.config;
        this.maxRetries = options.maxRetries ?? 3;
        this.retryDelayMs = options.retryDelayMs ?? 1000;
        this.timeoutMs = options.timeoutMs ?? 300_000;
        this.streaming = options.streaming ?? true;
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

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            // 非首次请求时等待（指数退避）；流式下通知消费方清空已展示的部分内容
            if (attempt > 0) {
                const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
                await sleep(delay);
                options?.onStreamReset?.();
            }

            try {
                const useStream = this.streaming && !this.streamingDisabled;
                const parsed = useStream
                    ? await this.requestStream(url, messages, options)
                    : this.parseResponse(
                          await this.fetchWithTimeout(url, this.buildRequestBody(messages, options, false)),
                      );
                this.usageTotals.calls += 1;
                if (parsed.usage) {
                    this.usageTotals.promptTokens += parsed.usage.promptTokens;
                    this.usageTotals.completionTokens += parsed.usage.completionTokens;
                    this.usageTotals.totalTokens += parsed.usage.totalTokens;
                }
                return parsed;
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

    /** 本客户端生命周期内的累计 token 用量与调用次数 */
    getUsageTotals(): UsageTotals {
        return { ...this.usageTotals };
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

    /**
     * 发送聊天请求并对文本响应做自定义校验，校验失败时追加纠正提示重试。
     *
     * 复用与 {@link chatJSON} 相同的"纠正式重试"骨架，但校验逻辑由调用方提供
     * （例如引用行号校验）。始终返回最终内容与校验产出的值（即使未通过校验，
     * 以便调用方保留尽力而为的结果）。
     *
     * @param messages - 聊天消息列表
     * @param validate - 校验函数，返回 { ok, value, error }
     * @param options  - 可选：maxFixes（默认 1）；fixPrompt 纠正提示引导语（默认英文模板，
     *                   校验错误列表会追加在其后）
     */
    async chatWithValidation<T>(
        messages: ChatMessage[],
        validate: (content: string) => { ok: boolean; value: T; error?: string },
        options?: { maxFixes?: number; fixPrompt?: string },
    ): Promise<{ content: string; value: T; ok: boolean }> {
        const maxFixes = options?.maxFixes ?? 1;
        const fixPrompt =
            options?.fixPrompt ??
            'Your previous output had the following problems. Fix them and output the full corrected document again (same language as before):';

        let current = messages;
        let last = await this.chat(current);
        let result = validate(last.content);
        let attempts = 0;

        while (!result.ok && attempts < maxFixes) {
            attempts += 1;
            current = [
                ...current,
                { role: 'assistant', content: last.content },
                {
                    role: 'user',
                    content: `${fixPrompt}\n${result.error ?? ''}`,
                },
            ];
            last = await this.chat(current);
            result = validate(last.content);
        }

        return { content: last.content, value: result.value, ok: result.ok };
    }

    // ========================================================================
    // 私有方法
    // ========================================================================

    /**
     * 构建 OpenAI 兼容的请求体
     */
    private buildRequestBody(
        messages: ChatMessage[],
        options: ChatOptions | undefined,
        stream: boolean,
        streamUsage = true,
    ): string {
        const payload: Record<string, unknown> = {
            model: this.config.modelName,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            temperature: options?.temperature ?? 0.3,
        };

        if (options?.maxTokens !== undefined) {
            payload['max_tokens'] = options.maxTokens;
        }

        if (stream) {
            payload['stream'] = true;
            // stream_options 请求供应商在末 chunk 回传 usage；个别端点不识别该参数
            if (streamUsage) {
                payload['stream_options'] = { include_usage: true };
            }
        }

        return JSON.stringify(payload);
    }

    /**
     * 流式请求入口：处理端点不支持流式时的降级。
     *
     * 400/404 可能是端点不识别 `stream_options` 或 `stream` 参数：
     * 先去掉 stream_options 重试一次；仍失败则置 {@link streamingDisabled}
     * 并在同一 attempt 内改发非流式（不消耗 chat() 的重试次数）。
     */
    private async requestStream(
        url: string,
        messages: ChatMessage[],
        options?: ChatOptions,
    ): Promise<LLMResponse> {
        try {
            return await this.fetchStream(url, this.buildRequestBody(messages, options, true), options);
        } catch (error) {
            if (!(error instanceof LLMError) || (error.statusCode !== 400 && error.statusCode !== 404)) {
                throw error;
            }
        }

        try {
            return await this.fetchStream(
                url,
                this.buildRequestBody(messages, options, true, false),
                options,
            );
        } catch (error) {
            if (!(error instanceof LLMError) || (error.statusCode !== 400 && error.statusCode !== 404)) {
                throw error;
            }
        }

        this.streamingDisabled = true;
        return this.parseResponse(
            await this.fetchWithTimeout(url, this.buildRequestBody(messages, options, false)),
        );
    }

    /**
     * 发送流式请求并解析 SSE 响应。
     *
     * 超时语义为**空闲超时**：abort 定时器在每个数据块到达时重置，
     * 只要数据持续流动就不会超时；网络中断（如系统休眠）时最多等待 timeoutMs。
     */
    private async fetchStream(url: string, body: string, options?: ChatOptions): Promise<LLMResponse> {
        const controller = new AbortController();
        let timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const resetIdle = () => {
            clearTimeout(timer);
            timer = setTimeout(() => controller.abort(), this.timeoutMs);
        };

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

            if (!response.ok) {
                const responseBody = await response.text().catch(() => '');
                this.handleErrorStatus(response.status, responseBody);
            }

            // 供应商忽略 stream 参数直接回整体 JSON 的情形：按非流式解析
            // （body 读取仍受同一 abort 信号保护）
            const contentType = response.headers.get('content-type') ?? '';
            if (!contentType.includes('text/event-stream')) {
                return this.parseResponse(await response.text());
            }

            const reader = response.body?.getReader();
            if (!reader) {
                return this.parseResponse(await response.text());
            }

            const decoder = new TextDecoder();
            let buffer = '';
            let content = '';
            let usage: LLMResponse['usage'];

            for (;;) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                resetIdle();
                buffer += decoder.decode(value, { stream: true });

                let newlineIndex: number;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
                    buffer = buffer.slice(newlineIndex + 1);

                    if (!line.startsWith('data:')) {
                        continue;
                    }
                    const data = line.slice(5).trim();
                    if (!data || data === '[DONE]') {
                        continue;
                    }

                    let chunk: {
                        choices?: Array<{ delta?: { content?: string } }>;
                        usage?: {
                            prompt_tokens?: number;
                            completion_tokens?: number;
                            total_tokens?: number;
                        };
                    };
                    try {
                        chunk = JSON.parse(data);
                    } catch {
                        continue;
                    }

                    const delta = chunk.choices?.[0]?.delta?.content;
                    if (typeof delta === 'string' && delta.length > 0) {
                        content += delta;
                        options?.onToken?.(delta);
                    }
                    if (chunk.usage) {
                        usage = {
                            promptTokens: chunk.usage.prompt_tokens ?? 0,
                            completionTokens: chunk.usage.completion_tokens ?? 0,
                            totalTokens: chunk.usage.total_tokens ?? 0,
                        };
                    }
                }
            }

            const result: LLMResponse = { content };
            if (usage) {
                result.usage = usage;
            }
            return result;
        } catch (error) {
            if (error instanceof LLMError) {
                throw error;
            }

            if (error instanceof DOMException && error.name === 'AbortError') {
                throw new LLMError(`流式响应空闲超时 (${this.timeoutMs}ms 无数据)`);
            }

            throw new LLMError(
                `网络请求失败: ${error instanceof Error ? error.message : '未知错误'}`,
            );
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * 带超时控制的 fetch 请求
     */
    private async fetchWithTimeout(url: string, body: string): Promise<string> {
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

            // 响应体必须在超时窗口内读完：网络中断（如系统休眠）时
            // body 读取会无限悬挂，abort 信号需要覆盖到这里
            return await response.text();
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
     * 从 OpenAI 兼容响应体中解析内容和 usage
     */
    private parseResponse(bodyText: string): LLMResponse {
        let json: {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
            };
        };
        try {
            json = JSON.parse(bodyText);
        } catch {
            throw new LLMError(`响应不是合法 JSON: ${bodyText.slice(0, 200)}`);
        }

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
