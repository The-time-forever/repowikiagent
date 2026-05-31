import type { WikiPage, ProjectProfile } from '../models/index.js';
import * as path from 'node:path';

/**
 * 提取页面所在的分组名称（即它所在的相对目录）
 */
function getPageGroup(page: WikiPage): string {
    const dir = path.dirname(page.filename);
    if (dir === '.' || dir === '/' || !dir) {
        return '根目录';
    }
    // 返回最上层或次上层的目录名作为分组名
    return dir.replace(/\\/g, '/');
}

/**
 * 清理文件名，去除 .md 后缀
 */
function stripMarkdownExtension(filePath: string): string {
    if (filePath.endsWith('.md')) {
        return filePath.slice(0, -3);
    }
    return filePath;
}

/**
 * 生成符合 GitHub Wiki 扁平或路径兼容的 Wiki 链接
 * 格式：[[显示名称|路径（无后缀）]]
 */
function formatWikiLink(page: WikiPage): string {
    const cleanPath = stripMarkdownExtension(page.filename).replace(/\\/g, '/');
    return `[[${page.title}|${cleanPath}]]`;
}

/**
 * 生成 _Sidebar.md 内容，按目录分组展示
 */
export function generateSidebar(pages: WikiPage[]): string {
    const groups: Record<string, WikiPage[]> = {};

    for (const page of pages) {
        // 跳过 Home.md 和 _Sidebar.md 本身以避免循环链接
        const basename = path.basename(page.filename).toLowerCase();
        if (basename === 'home.md' || basename === '_sidebar.md') {
            continue;
        }

        const group = getPageGroup(page);
        if (!groups[group]) {
            groups[group] = [];
        }
        groups[group].push(page);
    }

    const lines: string[] = ['# 项目文档导航', ''];

    // 定义常见分组的优先级排序，未定义的排在后面
    const groupOrder = [
        '项目概述',
        '架构设计',
        '核心功能模块',
        '前端应用架构',
        '后端服务架构',
        '数据库设计',
        'API 参考文档',
        'AI 集成与提示词设计',
        '安全与认证',
        '开发者指南',
        '部署与运维',
        '故障排除与常见问题',
        '根目录',
    ];

    const sortedGroups = Object.keys(groups).sort((a, b) => {
        const indexA = groupOrder.indexOf(a);
        const indexB = groupOrder.indexOf(b);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.localeCompare(b);
    });

    for (const group of sortedGroups) {
        const groupPages = groups[group];
        if (group === '根目录') {
            lines.push('### 其他文档');
        } else {
            lines.push(`### ${group}`);
        }

        for (const page of groupPages) {
            lines.push(`- ${formatWikiLink(page)}`);
        }
        lines.push('');
    }

    return lines.join('\n').trim() + '\n';
}

/**
 * 生成 Home.md 内容，为 Wiki 主页提供项目概览及索引导航
 */
export function generateHome(pages: WikiPage[], projectProfile: ProjectProfile): string {
    const lines: string[] = [];

    lines.push(`# 欢迎使用 ${projectProfile.name} 项目 Wiki`);
    lines.push('');
    lines.push('这是一个由 RepoWiki 自动生成的本地代码库知识库。');
    lines.push('');

    // 项目基本信息卡片
    lines.push('## 项目概要');
    lines.push('');
    lines.push(`- **项目名称**: \`${projectProfile.name}\``);
    lines.push(`- **主力语言**: ${projectProfile.languages.join(', ') || '未知'}`);
    if (projectProfile.frameworks.length > 0) {
        lines.push(`- **使用框架**: ${projectProfile.frameworks.join(', ')}`);
    }
    if (projectProfile.databases.length > 0) {
        lines.push(`- **数据库**: ${projectProfile.databases.join(', ')}`);
    }
    lines.push('');

    // 全量 Wiki 导航索引
    lines.push('## 知识库目录索引');
    lines.push('');

    const sidebarContent = generateSidebar(pages);
    // 移除侧边栏标题以融合到 Home.md 中
    const bodyContent = sidebarContent.replace('# 项目文档导航\n\n', '');
    lines.push(bodyContent);

    return lines.join('\n').trim() + '\n';
}
