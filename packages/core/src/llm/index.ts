/**
 * @module llm
 * @description LLM 层入口 - 统一导出认证管理、客户端和提示词管理功能。
 */

// 认证管理
export type { LLMConfig } from './auth-manager.js';
export { loadLLMConfig, saveGlobalConfig, validateConfig } from './auth-manager.js';

// 提供商预设
export type { ProviderPreset } from './providers.js';
export { PROVIDER_PRESETS, findProviderByEndpoint } from './providers.js';

// LLM 客户端
export type { ChatMessage, LLMClientOptions, LLMResponse, ChatOptions } from './llm-client.js';
export { LLMClient, LLMError, LLMAuthError, LLMRateLimitError, LLMJsonParseError } from './llm-client.js';

// 提示词管理
export {
    buildModuleAnalysisPrompt,
    buildMermaidPrompt,
    buildWikiPagePrompt,
    buildWikiPlanPrompt,
    buildSourceSummaryPrompt,
} from './prompt-manager.js';
