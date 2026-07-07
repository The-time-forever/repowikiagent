# RepoWiki TUI 需求简版 v0.1

## 目标

为 RepoWiki Agent 增加一个面向用户交互体验的 TUI 界面，让用户可以在终端中更直观地浏览生成的 Wiki、查看项目知识结构，并通过对话理解项目。

该 TUI 的重点不是展示 RepoWiki 自身的内部实现，而是帮助用户理解目标代码库。

核心体验：

```text
浏览 Wiki 结构 → 选择页面/模块 → 与 AI 对话 → 查看引用来源 → 打开相关源码
```

------

## 设计定位

TUI 应该是 RepoWiki 的交互式阅读与问答界面。

它面向的用户是：

1. 想快速理解自己项目的开发者；
2. 想学习陌生代码库的开发者；
3. 使用 vibe coding 生成项目后，需要读懂和维护项目的用户；
4. 不想频繁输入 CLI 参数，希望通过界面完成浏览和提问的用户。

------

## 非目标

本阶段不做以下内容：

1. 不展示 RepoWiki 内部的 metadata 细节；
2. 不展示 pipeline、scanner、analyzer 等内部实现流程；
3. 不做完整 IDE；
4. 不做 Markdown 编辑器；
5. 不做 Web UI；
6. 不替代现有 CLI 命令；
7. 不强制用户使用 TUI；
8. 不做复杂项目管理功能。

metadata 可以作为内部数据源使用，但不应该以“metadata 页面”或“pipeline 页面”的形式暴露给普通用户。

------

## 命令入口

用户执行 `repowiki` 命令后，应像常见 CLI 工具一样自动进行环境检测，并根据当前项目状态决定行为：

1. 如果当前目录尚未生成 RepoWiki，则进入首次使用流程；
2. 如果已经存在 RepoWiki，则直接进入 TUI 界面。

同时仍支持显式子命令：

```bash
repowiki tui [path]
```

默认路径为当前目录：

```bash
repowiki tui .
```

可选参数：

```bash
repowiki tui --lang zh
repowiki tui --lang en
repowiki tui --topk 5
```

------

## 首次进入行为

启动后检查当前项目是否已经生成 RepoWiki。

如果没有生成 Wiki，显示简洁提示：

```text
No RepoWiki found.

> Generate Wiki
  Exit
```

用户选择 Generate Wiki 后，复用现有 generate 能力生成 Wiki。

如果已经存在 Wiki，直接进入 TUI 主界面。

同时，系统应具备基础的更新检测能力：

1. 如果当前仓库存在 Git：

   - 通过对比最近一次生成 Wiki 时记录的 commit 与当前 HEAD；

   - 若存在差异，提示用户：

     ```text
     Repo has changed since last Wiki generation.
     
     > Update Wiki
       Skip
     ```

   - 用户可选择执行增量更新或跳过。

2. 如果当前仓库不存在 Git：

   - 不进行全量文件扫描以避免资源浪费；
   - 仅在以下情况下提示更新：
     - 用户手动触发更新；
     - 或基于轻量级策略（如文件数量变化、时间戳摘要等）检测到明显变化；
   - 默认不主动打扰用户。

该机制的目标是在保证更新准确性的同时，避免对无 Git 项目进行高成本的全仓库扫描。

------

## 主界面布局

推荐采用三栏或上下组合布局：

```text
┌──────────────────── RepoWiki TUI ────────────────────┐
│ Project: my-app                         Lang: zh      │
├──────────── Wiki Structure ────────┬────── Page ──────┤
│ ▾ Overview                         │ # Project Guide  │
│ ▾ Frontend                         │                  │
│   ├─ Components                    │ 当前页面摘要...   │
│   ├─ State                         │                  │
│   └─ Routes                        │ Sources:         │
│ ▾ Backend                          │ - src/app.ts:12  │
│   ├─ API                           │ - src/router.ts  │
│   └─ Database                      │                  │
├────────────────── Chat ───────────────────────────────┤
│ Ask about this repo or current page...                │
└────────────────────────────────────────────────────────┘
```

界面核心区域：

1. Wiki Structure：图形化展示 Wiki 结构；
2. Page：展示当前选中的 Wiki 页面摘要、正文或来源；
3. Chat：支持自然语言对话；
4. Sources：展示当前回答或页面关联的源码引用。

------

## Wiki 结构展示

TUI 必须能够图形化展示 Wiki 结构。

这里的“图形化”指终端内的树状结构，而不是 Web 图表。

示例：

```text
Wiki Structure

▾ Project Overview
▾ User Interface
  ├─ Components
  ├─ Routing
  └─ State Management
▾ Backend
  ├─ API Routes
  ├─ Services
  └─ Database Models
▾ Configuration
▾ Testing
```

要求：

1. 从生成的 Wiki 信息中读取页面层级；
2. 展示用户能理解的 Wiki 页面标题；
3. 不展示内部 metadata 文件名；
4. 不展示 RepoWiki 自身 pipeline；
5. 支持展开/折叠；
6. 支持上下选择；
7. 支持 Enter 打开页面；
8. 支持搜索页面标题。

------

## 页面浏览

用户选择 Wiki 页面后，右侧显示页面内容。

第一阶段可以只展示：

1. 页面标题；
2. 页面摘要；
3. 关键内容预览；
4. 关联源码引用；
5. 可执行操作。

示例：

```text
Page: Components

This page explains the main UI components and how they are organized.

Sources:
1. src/components/AppShell.tsx#L10-L80
2. src/components/Sidebar.tsx#L1-L64

Actions:
> Ask about this page
  Open source
  Open markdown
```

------

## 对话功能

TUI 必须支持对话，这是核心功能。

对话分两种上下文：

### 1. Ask current page

针对当前选中的 Wiki 页面提问。

示例问题：

```text
这个页面讲的模块是干什么的？
我没懂这个组件之间的关系，用简单的话解释一下。
如果我要改这个功能，应该看哪些文件？
```

回答应优先基于当前页面及其关联源码。

### 2. Ask whole repo

针对整个项目提问。

示例问题：

```text
这个项目是干什么的？
我应该从哪里开始读？
前端和后端是怎么连接的？
这个项目的核心模块有哪些？
```

回答应基于 Wiki 全局检索结果。

------

## 对话回答格式

回答要面向理解项目，不要像普通聊天一样发散。

推荐格式：

```text
Answer:
简洁回答用户问题。

Related files:
- src/xxx.ts#L10-L50
- src/yyy.ts#L20-L90

Next:
- Ask follow-up
- Open source
- Show related Wiki page
```

要求：

1. 回答必须尽量引用 Wiki 页面或源码；
2. 回答要说明“应该看哪些文件”；
3. 回答不要暴露内部 metadata；
4. 回答不要解释 RepoWiki 自己的生成 pipeline，除非用户正在分析 RepoWiki 项目本身；
5. 支持连续追问；
6. 支持基于当前页面的上下文对话。

------

## 源码引用与打开

当页面或回答中出现源码引用时，TUI 应显示引用列表。

示例：

```text
Sources

> src/main.ts#L1-L40
  src/router.ts#L20-L88
  src/components/App.tsx#L10-L60
```

操作：

1. Enter 打开源码；
2. 支持用 VS Code 打开到指定行；
3. 如果无法打开编辑器，则复制或显示路径；
4. 支持返回 TUI。

------

## 搜索功能

TUI 应支持快速搜索 Wiki 页面。

快捷键建议：

```text
/    Search Wiki
```

搜索范围：

1. 页面标题；
2. 页面摘要；
3. 页面正文；
4. 关联文件路径。

搜索结果示例：

```text
Search: auth

1. Authentication
2. API Middleware
3. User Session
```

------

## 快捷键建议

```text
↑ / ↓     Move selection
Enter     Open selected page/source
Tab       Switch panel
/         Search Wiki
a         Ask current page
A         Ask whole repo
o         Open source
r         Show references
u         Update Wiki
q         Quit
```

------

## 更新 Wiki

TUI 中可以提供简单更新入口：

```text
Update Wiki

> Incremental update
  Force rebuild
  Cancel
```

该功能只作为入口，内部复用现有 generate 能力。

------

## 技术建议

第一版建议直接做真正 TUI，而不是普通 prompt 菜单。

推荐技术：

```text
ink
```

原因：

1. 项目是 TypeScript；
2. Ink 适合做终端内组件化界面；
3. 适合实现 Wiki tree、页面预览、chat panel；
4. 后续可以逐步扩展。

不建议第一版只用 `@clack/prompts`，因为当前目标已经明确是提升交互体验和图形化浏览 Wiki 结构，而不是简单命令向导。

------

## MVP 范围

第一版只需要实现以下内容：

1. 新增 `repowiki tui [path]`；
2. 检测 `.repowiki` 是否存在；
3. 读取 Wiki 页面结构；
4. 左侧树状展示 Wiki；
5. 右侧展示当前页面摘要或内容；
6. 底部支持对话输入；
7. 支持 Ask current page；
8. 支持 Ask whole repo；
9. 显示回答引用来源；
10. 支持打开源码文件；
11. 支持搜索 Wiki 页面；
12. 支持退出和返回。

------

## 暂不实现

第一版暂不做：

1. 完整 Markdown 渲染；
2. Mermaid 图渲染；
3. 多窗口布局自定义；
4. 鼠标操作；
5. 主题系统；
6. 对话历史持久化；
7. 多项目管理；
8. 插件系统；
9. Web UI；
10. RepoWiki 内部 pipeline 可视化。

------

## 验收标准

完成后应满足：

1. 用户运行 `repowiki tui` 后可以进入终端界面；
2. 用户能看到清晰的 Wiki 树状结构；
3. 用户能选择 Wiki 页面并查看内容；
4. 用户能针对当前页面提问；
5. 用户能针对整个项目提问；
6. AI 回答能显示相关 Wiki 或源码引用；
7. 用户能从引用打开源码；
8. 普通用户不会看到 metadata、pipeline 等内部实现细节；
9. 现有 CLI 命令不受影响；
10. TUI 对“理解项目”和“学习 vibe coding 项目”有明显帮助。

------

## 一句话总结

RepoWiki TUI 的目标不是展示 RepoWiki 如何生成 Wiki，而是让用户在终端中更直观地浏览 Wiki 结构，并通过对话理解自己的项目或 AI 生成的项目。