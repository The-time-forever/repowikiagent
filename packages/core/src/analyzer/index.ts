/**
 * analyzer 模块入口
 * 包含模块聚类、API 路由提取、数据库模型分析、配置与工作流识别等核心静态分析能力。
 */

export {
    analyzeModules,
} from './module-analyzer.js';

export {
    analyzeApiRoutes,
} from './api-analyzer.js';

export {
    analyzeDatabaseModels,
} from './database-analyzer.js';

export {
    analyzeConfigs,
    type ConfigInfo,
} from './config-analyzer.js';

export {
    analyzeWorkflows,
    type WorkflowInfo,
} from './workflow-analyzer.js';
