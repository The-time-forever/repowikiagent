import { Command } from 'commander';
import {
    scanDirectory,
    buildTreeString,
    detectTechStack,
    detectEntrypoints,
    buildDependencyGraph,
    analyzeModules,
    analyzeApiRoutes,
    analyzeDatabaseModels,
    analyzeConfigs,
    analyzeWorkflows,
} from 'repowiki-core';
import * as path from 'node:path';
import chalk from 'chalk';

export const scanCommand = new Command('scan')
    .arguments('[path]')
    .description('对指定目录运行 AST 扫描和静态分析，并输出原始 JSON 数据')
    .option('--pretty', '格式化输出的 JSON 文本')
    .action(async (targetPath, options) => {
        const workspacePath = path.resolve(targetPath || '.');
        const pretty = !!options.pretty;

        try {
            const files = await scanDirectory(workspacePath);
            const treeStr = buildTreeString(files, workspacePath);
            const techStackResult = await detectTechStack(workspacePath, files);
            const entrypoints = await detectEntrypoints(workspacePath, files);
            const dependencyGraph = await buildDependencyGraph(workspacePath, files);
            const modules = await analyzeModules(workspacePath, files, null); // 不使用 LLM
            const apiRoutes = await analyzeApiRoutes(workspacePath, files);
            const databaseModels = await analyzeDatabaseModels(workspacePath, files);
            const configInfos = await analyzeConfigs(workspacePath, files);
            const workflowInfos = await analyzeWorkflows(workspacePath, files);

            const result = {
                project: {
                    name: path.basename(workspacePath) || 'unnamed-project',
                    rootPath: workspacePath,
                    languages: techStackResult.languages,
                    frameworks: techStackResult.frameworks,
                    packageManagers: techStackResult.packageManagers,
                    databases: techStackResult.databases,
                    services: techStackResult.services,
                    entrypoints,
                    configFiles: techStackResult.configFiles,
                },
                tree: treeStr,
                modules,
                dependencies: dependencyGraph,
                apiRoutes,
                databaseModels,
                configs: configInfos,
                workflows: workflowInfos,
            };

            const jsonOutput = pretty
                ? JSON.stringify(result, null, 2)
                : JSON.stringify(result);

            console.log(jsonOutput);
        } catch (err: any) {
            console.error(chalk.red('错误: 扫描失败:'), err?.message || err);
            process.exit(1);
        }
    });
