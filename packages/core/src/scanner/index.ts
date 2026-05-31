/**
 * @module scanner
 * 文件扫描器统一导出
 */

export {
    DEFAULT_IGNORE_PATTERNS,
    SENSITIVE_FILE_PATTERNS,
    createIgnoreFilter,
} from './ignore-rules.js';

export {
    type ScannerConfig,
    scanDirectory,
} from './file-scanner.js';

export {
    buildTreeString,
} from './tree-builder.js';
