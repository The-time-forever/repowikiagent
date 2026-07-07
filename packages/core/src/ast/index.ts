/**
 * ast 模块入口：tree-sitter 符号提取（WASM，懒加载，失败降级）。
 */

export {
    extractSymbols,
    renderSymbolOutline,
    languageIdForFile,
    type SymbolInfo,
} from './symbol-extractor.js';
