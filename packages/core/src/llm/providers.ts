/**
 * @module providers
 * @description 常见 LLM API 提供商预设（OpenAI 兼容端点）。
 * 供 login 向导等消费端做"选提供商 → 自动填 endpoint/模型"，
 * 参考 opencode 等 CLI 的处理方式。
 *
 * 约束：LLMClient 走 OpenAI 兼容协议（apiEndpoint + /chat/completions），
 * 因此这里只收录提供 OpenAI 兼容层的端点。
 */

/** 单个提供商预设 */
export interface ProviderPreset {
    id: string;
    /** 显示名（含中文注记） */
    name: string;
    /** OpenAI 兼容 base URL（不含 /chat/completions） */
    endpoint: string;
    defaultModel: string;
    /** 获取 API key 的页面（向导提示用） */
    keyUrl?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
    {
        id: 'openai',
        name: 'OpenAI',
        endpoint: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o',
        keyUrl: 'https://platform.openai.com/api-keys',
    },
    {
        id: 'anthropic',
        name: 'Anthropic Claude',
        endpoint: 'https://api.anthropic.com/v1',
        defaultModel: 'claude-sonnet-4-5',
        keyUrl: 'https://console.anthropic.com/settings/keys',
    },
    {
        id: 'deepseek',
        name: 'DeepSeek 深度求索',
        endpoint: 'https://api.deepseek.com/v1',
        defaultModel: 'deepseek-chat',
        keyUrl: 'https://platform.deepseek.com/api_keys',
    },
    {
        id: 'moonshot',
        name: 'Moonshot Kimi 月之暗面',
        endpoint: 'https://api.moonshot.cn/v1',
        defaultModel: 'kimi-k2-0905-preview',
        keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    },
    {
        id: 'zhipu',
        name: '智谱 GLM',
        endpoint: 'https://open.bigmodel.cn/api/paas/v4',
        defaultModel: 'glm-4.6',
        keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    },
    {
        id: 'dashscope',
        name: '阿里云百炼 Qwen',
        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        defaultModel: 'qwen-plus',
        keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    },
    {
        id: 'siliconflow',
        name: 'SiliconFlow 硅基流动',
        endpoint: 'https://api.siliconflow.cn/v1',
        defaultModel: 'deepseek-ai/DeepSeek-V3',
        keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        endpoint: 'https://openrouter.ai/api/v1',
        defaultModel: 'openai/gpt-4o',
        keyUrl: 'https://openrouter.ai/settings/keys',
    },
    {
        id: 'groq',
        name: 'Groq',
        endpoint: 'https://api.groq.com/openai/v1',
        defaultModel: 'llama-3.3-70b-versatile',
        keyUrl: 'https://console.groq.com/keys',
    },
    {
        id: 'gemini',
        name: 'Google Gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
        defaultModel: 'gemini-2.5-flash',
        keyUrl: 'https://aistudio.google.com/apikey',
    },
    {
        id: 'xai',
        name: 'xAI Grok',
        endpoint: 'https://api.x.ai/v1',
        defaultModel: 'grok-4',
        keyUrl: 'https://console.x.ai',
    },
];

/** 归一化 endpoint 比较（忽略尾部斜杠与大小写） */
function normalizeEndpoint(endpoint: string): string {
    return endpoint.trim().replace(/\/+$/, '').toLowerCase();
}

/** 按 endpoint 反查预设；未命中返回 null */
export function findProviderByEndpoint(endpoint: string): ProviderPreset | null {
    const normalized = normalizeEndpoint(endpoint);
    return PROVIDER_PRESETS.find((p) => normalizeEndpoint(p.endpoint) === normalized) ?? null;
}
