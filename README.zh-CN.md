# RepoWiki Agent

[![npm version](https://img.shields.io/npm/v/repowiki-agent.svg)](https://www.npmjs.com/package/repowiki-agent)
[![npm package](https://img.shields.io/badge/npm-repowiki--agent-cb3837)](https://www.npmjs.com/package/repowiki-agent)

[English](README.md) | 简体中文

RepoWiki Agent 是一个本地优先的代码库 Wiki 生成 CLI。它会扫描项目结构、识别技术栈、规划分层主题树，并在 `.repowiki/<lang>/` 下生成多页面、**有据可查**的 Markdown 文档。

亮点：

- **可追溯引用** —— 每个涉及代码的章节都引用真实的 `file://path#Lstart-Lend` 行号，并对照扫描到的文件做校验（非法引用会触发纠正式重试）。
- **分层目录** —— 概览 → 分区 → 各模块/各 API 的主题树，含分区着陆页。
- **双语** —— 可生成 `zh`、`en` 或 `both`；标签与图表均随语言切换。
- **增量更新** —— 再次运行只重生成源码发生变化的页面（基于元数据依赖图）；无变更则不做任何改动。

当前公开包聚焦 CLI：

- CLI npm 包名：`repowiki-agent`
- Core npm 包名：`repowiki-core`
- 安装后的命令名：`repowiki`

## 安装

```powershell
npm install -g repowiki-agent
```

检查命令是否可用：

```powershell
repowiki --help
```

## 快速开始

为当前代码库生成 Wiki：

```powershell
repowiki generate .
```

默认按语言输出到：

```text
.repowiki/<lang>/content/                        # Wiki 页面
.repowiki/<lang>/meta/repowiki-metadata.json     # 增量更新依赖图
```

例如 `.repowiki/en/`。可指定语言（或同时生成两种）：

```powershell
repowiki generate . --lang zh
repowiki generate . --lang both
```

不使用大模型，仅用本地静态分析和模板生成：

```powershell
repowiki generate . --skip-llm
```

本地模式仍然可以生成项目结构报告，但内容更偏结构化整理，不会有模型辅助下的业务语义总结和架构解释。

## 配置模型

RepoWiki 支持 OpenAI-compatible API endpoint。可以使用登录向导：

```powershell
repowiki login
```

也可以直接设置：

```powershell
repowiki config set endpoint https://api.openai.com/v1
repowiki config set model gpt-4o
repowiki config set key <your-api-key>
```

查看当前配置：

```powershell
repowiki config get
```

配置会保存到：

```text
~/.repowiki/config.json
```

也支持通过环境变量配置：

```text
REPOWIKI_API_KEY
REPOWIKI_BASE_URL
REPOWIKI_MODEL
OPENAI_API_KEY
OPENAI_BASE_URL
```

## 命令

```powershell
repowiki generate [path]
```

为指定项目生成 Wiki 文档。

常用参数：

```text
-o, --output <dir>       输出根目录（默认 <path>/.repowiki，语言树位于 <root>/<lang>）
-m, --model <model>      覆盖默认模型名
-c, --concurrency <n>    大模型请求并发数（现已真正并行分析与页面生成）
-l, --lang <lang>        文档语言：zh | en | both（默认 en）
-s, --strategy <s>       目录组织策略：feature | package（默认 feature）
--force-rebuild          强制全量重建，忽略已有元数据的增量更新
--dry-run                只估算成本（页数、LLM 调用数、token 量），零调用零写入
--slug-filenames         文件名使用 ASCII slug（跨平台与 URL 兼容）
--skip-llm               使用本地模式生成
--json-stdout            以 JSON Lines 输出进度
```

### 成本预估（dry run）

在花费 token 之前，先预览一次运行的成本：

```powershell
repowiki generate . --dry-run
```

输出逐页表格（grounding 文件数、预计输入/输出 token）与合计，全程零 LLM 调用、零写入。已有元数据时按增量口径估算受影响页。

### 增量更新

首次生成后，`.repowiki/<lang>/meta/repowiki-metadata.json` 会记录每个页面的 `dependent_files` 及其内容指纹。再次运行 `repowiki generate` 时，会检测变更文件（有 `git` 时走 git 快路，否则按内容哈希），反查受影响页面并**只重生成这些页**，其余页面原样保留；无变更时报告"已是最新"且不写入任何文件。使用 `--force-rebuild` 可跳过增量、全量重建。

目录结构会随项目演进：新增文件落在已有页面覆盖的目录中会归入该页；**新目录**下有 2 个以上文件时会自动聚类成新页挂入模块分区，侧边栏与首页索引同步刷新。

### 代码库问答

wiki 生成之后，可以直接对它提问（回答带页面来源与源码行引用）：

```powershell
repowiki ask "增量更新是怎么实现的?"
repowiki chat          # 多轮问答，/exit 退出
```

检索在本地对已生成的 wiki 进行（无需向量库）。`ask`、`chat` 与 TUI 的回答均为流式逐字输出；所有 LLM 请求底层都走流式，`timeoutMs` 的语义变为**空闲超时**（相邻数据块的最大间隔），长文生成不再与固定时钟赛跑。端点不支持 SSE 时自动降级为非流式。

### 终端交互界面（TUI）

```powershell
repowiki            # 交互式终端下直接运行 = 进入 TUI（未生成 wiki 时引导生成）
repowiki tui [path] # 显式进入；-l zh|en 指定语言，-k <n> 指定问答检索页数
```

TUI 提供三栏界面：左侧 Wiki 目录树（↑↓ 选择、←→ 折叠展开、Enter 打开）、右侧页面正文（滚动阅读，`r` 查看引用列表并可 Enter 用 VS Code 打开到源码行）、底部对话框（`a` 针对当前页提问、`A` 针对全库提问，回答带页面来源与源码引用）。`/` 搜索页面，`u` 增量更新/全量重建，`q` 退出。

启动时若检测到仓库自上次生成后有提交变更（依据元数据记录的 commit），会提示一键增量更新；非 git 项目不做自动扫描，仅 `u` 手动触发。非交互终端（管道/CI）下裸 `repowiki` 仍输出帮助，脚本行为不受影响。

### CI 集成

把 [`examples/github-actions/repowiki-update.yml`](examples/github-actions/repowiki-update.yml) 复制到你项目的 `.github/workflows/` 下，即可在每次 push 到 `main` 时增量更新 wiki 并自动提交。需要在仓库 secrets 配置 `REPOWIKI_API_KEY`，并确保项目的 .gitignore 没有排除 `.repowiki/`。

```powershell
repowiki scan [path] --pretty
```

运行本地静态分析，并输出原始 JSON 结果。

```powershell
repowiki config get
repowiki config set <key> <value>
```

管理全局 LLM 配置。

```powershell
repowiki login
```

交互式配置 endpoint、model 和 API key。
