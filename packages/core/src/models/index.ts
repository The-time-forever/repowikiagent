/**
 * models 模块入口
 * 统一导出所有数据模型 Schema 及类型定义。
 */

export {
    FileNodeSchema,
    type FileNode,
    SourceReferenceSchema,
    type SourceReference,
} from './file-reference.js';

export {
    ProjectProfileSchema,
    type ProjectProfile,
} from './project-profile.js';

export {
    CoreComponentSchema,
    type CoreComponent,
    ModuleInfoSchema,
    type ModuleInfo,
    ApiRouteSchema,
    type ApiRoute,
    DatabaseFieldSchema,
    type DatabaseField,
    DatabaseRelationSchema,
    type DatabaseRelation,
    DatabaseModelSchema,
    type DatabaseModel,
} from './analysis-types.js';

export {
    WikiPageSchema,
    type WikiPage,
} from './wiki-page.js';

export {
    DiagramKindSchema,
    type DiagramKind,
    type CatalogStrategy,
    CatalogNodeSchema,
    type CatalogNode,
} from './catalog.js';

export {
    DependencyEdgeSchema,
    DependencyGraphSchema,
    AnalysisResultSchema,
    type AnalysisResult,
} from './analysis-result.js';

