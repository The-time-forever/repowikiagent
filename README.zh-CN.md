# RepoWiki Agent

[![npm version](https://img.shields.io/npm/v/repowiki-agent.svg)](https://www.npmjs.com/package/repowiki-agent)
[![npm package](https://img.shields.io/badge/npm-repowiki--agent-cb3837)](https://www.npmjs.com/package/repowiki-agent)

[English](README.md) | 简体中文

RepoWiki Agent 是一个本地优先的代码库 Wiki 生成 CLI。它会扫描项目结构、识别技术栈、提取模块和路由信息，并在 `docs/wiki` 下生成多页面 Markdown 文档。

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

默认输出目录：

```text
docs/wiki
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
-o, --output <dir>       输出目录
-m, --model <model>      覆盖默认模型名
-c, --concurrency <n>    大模型请求并发数
--skip-llm               使用本地模式生成
--json-stdout            以 JSON Lines 输出进度
```

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
