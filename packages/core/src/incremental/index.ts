/**
 * incremental 模块入口
 * 有元数据时按变更文件反查并只重生成受影响页。
 */

export {
    runIncrementalUpdate,
    computeChangeSets,
    findStale,
    entryToCatalogNode,
    type ChangeSets,
    type IncrementalResult,
    type IncrementalDeps,
} from './updater.js';
