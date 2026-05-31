/**
 * @module detector
 * 探测器模块入口
 *
 * 统一导出技术栈探测、入口文件探测和依赖关系探测的所有公开接口。
 */

export {
    type TechStackResult,
    detectTechStack,
} from './tech-stack-detector.js';

export {
    detectEntrypoints,
} from './entrypoint-detector.js';

export {
    type DependencyEdge,
    type DependencyGraph,
    buildDependencyGraph,
} from './dependency-detector.js';
