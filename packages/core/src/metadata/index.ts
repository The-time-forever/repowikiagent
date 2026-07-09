/**
 * metadata 模块入口
 * 产出/读取机器可读的 repowiki-metadata.json，并提供指纹计算。
 */

export {
    hashContent,
    fingerprintFile,
    collectDependentFiles,
    computeSourceIndex,
} from './fingerprint.js';

export {
    buildMetadata,
    writeMetadata,
    readMetadata,
    type RepowikiMetadata,
    type WikiCatalogEntry,
    type KnowledgeRelation,
    type WikiItem,
    type BuildMetadataParams,
    type UsageStats,
} from './metadata-writer.js';

export {
    buildWikiTree,
    splitDependentFiles,
    type WikiTreeNode,
} from './tree.js';
