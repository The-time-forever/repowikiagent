/**
 * grounding 模块入口
 * 提供带行号的源码供给与引用校验，支撑"每个论断可回溯到 file:line"。
 */

export {
    collectGroundedSources,
    renderGroundedSources,
    type GroundedSource,
    type SourceProviderOptions,
} from './source-provider.js';

export {
    validateCitations,
    formatCitationErrors,
    type CitationError,
    type CitationValidationResult,
} from './citation-validator.js';
