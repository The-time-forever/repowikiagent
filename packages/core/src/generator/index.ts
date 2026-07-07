/**
 * generator 模块入口
 * 负责将静态分析结果组装、排版为符合规范的 Markdown 格式 Wiki 文档，并生成 Mermaid 关系图表。
 */

export {
    generateTable,
    formatSourceRef,
    formatSectionSource,
    formatDiagramSource,
    formatCiteBlock,
    formatToc,
    formatFileTable,
    wrapMermaid,
    formatTroubleshootingTable,
    assembleWikiPage,
} from './markdown-generator.js';

export {
    generateArchitectureDiagram,
    generateERDiagram,
    generateDependencyDiagram,
    generateApiDiagram,
    generateTechStackDiagram,
} from './mermaid-generator.js';

export {
    generateSidebar,
    generateHome,
} from './sidebar-generator.js';

export {
    WikiGenerator,
    selectNodeFiles,
    type WikiGeneratorConfig,
} from './wiki-generator.js';

export {
    lintMermaid,
    lintMermaidBlock,
} from './mermaid-lint.js';

export {
    slugify,
    hashId,
    buildDefaultCatalog,
    flattenPlannedCatalog,
    validateCatalog,
    type PlannedCatalogNode,
    type CatalogValidationResult,
} from './catalog-builder.js';
