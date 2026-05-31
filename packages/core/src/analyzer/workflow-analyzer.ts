import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileNode } from '../models/index.js';

export interface WorkflowInfo {
    name: string;
    type: 'langchain' | 'langgraph' | 'custom-agent' | 'celery' | 'temporal' | 'custom-workflow';
    filePath: string;
    description: string;
    steps: string[];
}

/**
 * 根据导入和内容模式识别工作流/智能体类型
 */
function detectWorkflowType(content: string, relativePath: string): 'langchain' | 'langgraph' | 'custom-agent' | 'celery' | 'temporal' | 'custom-workflow' | null {
    const lowerContent = content.toLowerCase();
    const normalizedPath = relativePath.replace(/\\/g, '/').toLowerCase();

    if (lowerContent.includes('langgraph') || lowerContent.includes('stategraph')) {
        return 'langgraph';
    }
    if (lowerContent.includes('langchain') || lowerContent.includes('agentexecutor') || lowerContent.includes('create_react_agent')) {
        return 'langchain';
    }
    if (lowerContent.includes('celery') || lowerContent.includes('@shared_task') || lowerContent.includes('@app.task')) {
        return 'celery';
    }
    if (lowerContent.includes('temporalio') || lowerContent.includes('@workflow.defn') || lowerContent.includes('workflow.run')) {
        return 'temporal';
    }

    // 启发式路径规则
    if (normalizedPath.includes('/agent/') || normalizedPath.includes('/agents/') || normalizedPath.includes('agent.py') || normalizedPath.includes('agent.ts')) {
        return 'custom-agent';
    }
    if (normalizedPath.includes('/workflow/') || normalizedPath.includes('/workflows/') || normalizedPath.includes('/pipeline/') || normalizedPath.includes('/pipelines/')) {
        return 'custom-workflow';
    }

    return null;
}

/**
 * 提取工作流步骤或节点
 */
function extractSteps(content: string, type: string): string[] {
    const steps: string[] = [];

    switch (type) {
        case 'langgraph': {
            // 匹配 .add_node("name", ...) 或 .add_node('name', ...)
            const nodePattern = /\.add_node\(\s*['"]([^'"]+)['"]/g;
            let match: RegExpExecArray | null;
            while ((match = nodePattern.exec(content)) !== null) {
                steps.push(match[1]);
            }
            // 也可能匹配 .add_edge("nodeA", "nodeB")
            const edgePattern = /\.add_edge\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
            while ((match = edgePattern.exec(content)) !== null) {
                const edgeStr = `${match[1]} -> ${match[2]}`;
                if (!steps.includes(edgeStr)) {
                    steps.push(edgeStr);
                }
            }
            break;
        }
        case 'langchain': {
            // 匹配 Tool 定义或 Agent 步骤
            const toolPattern = /@tool\b|Tool\.from_function|class\s+(\w+Tool)\b/g;
            let match: RegExpExecArray | null;
            while ((match = toolPattern.exec(content)) !== null) {
                steps.push(match[1] || 'Registered Tool');
            }
            break;
        }
        case 'celery': {
            // 匹配任务函数
            const taskPattern = /@(?:app|shared)_task\s*(?:\([^)]*\))?\s*\n\s*(?:async\s+)?def\s+(\w+)/g;
            let match: RegExpExecArray | null;
            while ((match = taskPattern.exec(content)) !== null) {
                steps.push(match[1]);
            }
            break;
        }
        case 'temporal': {
            // 匹配活动或工作流定义
            const temporalPattern = /@workflow\.run\b\s*\n\s*(?:async\s+)?def\s+(\w+)|@activity\.defn\b\s*\n\s*(?:async\s+)?def\s+(\w+)/g;
            let match: RegExpExecArray | null;
            while ((match = temporalPattern.exec(content)) !== null) {
                steps.push(match[1] || match[2]);
            }
            break;
        }
        case 'custom-agent':
        case 'custom-workflow': {
            // 匹配类中的主要方法名，如 run, execute, process, invoke, step
            const methodPattern = /(?:async\s+)?def\s+(run|execute|process|invoke|step|start|next_step)\s*\(/g;
            let match: RegExpExecArray | null;
            while ((match = methodPattern.exec(content)) !== null) {
                steps.push(match[1]);
            }
            break;
        }
    }

    return Array.from(new Set(steps));
}

/**
 * 猜测工作流名称
 */
function deriveWorkflowName(content: string, filePath: string): string {
    const basename = path.basename(filePath, path.extname(filePath));

    // 尝试寻找类名定义，如 class Agent, class WritingWorkflow
    const classMatch = /class\s+(\w+(?:Agent|Workflow|Graph|Pipeline|Chain))\b/.exec(content);
    if (classMatch) {
        return classMatch[1];
    }

    return basename.replace(/^./, (c) => c.toUpperCase());
}

/**
 * 生成工作流简要描述
 */
function generateDescription(name: string, type: string, steps: string[]): string {
    const typeNames: Record<string, string> = {
        langgraph: 'LangGraph 状态图智能体工作流',
        langchain: 'LangChain 链式/智能体代理执行器',
        celery: 'Celery 分布式异步任务队列',
        temporal: 'Temporal 强一致性持久工作流',
        'custom-agent': '自定义 Agent 智能体逻辑',
        'custom-workflow': '自定义业务流程/工作流',
    };

    const typeDesc = typeNames[type] || '业务工作流';
    if (steps.length > 0) {
        return `${name} 是一个基于 ${typeDesc}，定义了包含 [${steps.join(', ')}] 等关键节点或步骤。`;
    }
    return `${name} 定义了项目中的 ${typeDesc} 流程。`;
}

/**
 * 分析项目中的智能体（Agent）和工作流（Workflow）设计模式
 *
 * 识别 LangGraph, LangChain, Celery, Temporal 以及自定义 Agent 结构，
 * 提取工作流节点与流转步骤。
 *
 * @param rootPath - 项目根目录
 * @param files - 扫描的文件节点
 */
export async function analyzeWorkflows(rootPath: string, files: FileNode[]): Promise<WorkflowInfo[]> {
    const workflows: WorkflowInfo[] = [];

    for (const file of files) {
        if (file.nodeType !== 'file') continue;

        // 仅对文本源文件分析
        const ext = path.extname(file.relativePath).toLowerCase();
        if (!['.py', '.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
            continue;
        }

        try {
            const absolutePath = path.resolve(rootPath, file.relativePath);
            const content = await fs.readFile(absolutePath, 'utf-8');

            const type = detectWorkflowType(content, file.relativePath);
            if (!type) continue;

            const name = deriveWorkflowName(content, file.relativePath);
            const steps = extractSteps(content, type);
            const description = generateDescription(name, type, steps);

            workflows.push({
                name,
                type,
                filePath: file.relativePath,
                description,
                steps,
            });
        } catch {
            // 忽略读取错误
        }
    }

    return workflows.sort((a, b) => a.filePath.localeCompare(b.filePath));
}
