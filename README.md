# RepoWiki Agent

[![npm version](https://img.shields.io/npm/v/repowiki-agent.svg)](https://www.npmjs.com/package/repowiki-agent)
[![npm package](https://img.shields.io/badge/npm-repowiki--agent-cb3837)](https://www.npmjs.com/package/repowiki-agent)

English | [简体中文](README.zh-CN.md)

RepoWiki Agent is a local-first CLI for generating Markdown wiki documentation from a code repository. It scans the project structure, detects technology stacks, extracts modules and routes, and writes a multi-page wiki under `docs/wiki`.

The public package focuses on the CLI:

- CLI npm package: `repowiki-agent`
- Core npm package: `repowiki-core`
- Command name after install: `repowiki`

## Install

```powershell
npm install -g repowiki-agent
```

Check the command:

```powershell
repowiki --help
```

## Quick Start

Generate a wiki for the current repository:

```powershell
repowiki generate .
```

By default, output is written to:

```text
docs/wiki
```

Generate without an LLM:

```powershell
repowiki generate . --skip-llm
```

This mode uses local static analysis and templates only. It can still produce a useful project structure report, but the content will be less semantic than model-assisted output.

## Configure Model Access

RepoWiki works with OpenAI-compatible API endpoints. Run the login wizard:

```powershell
repowiki login
```

Or configure values directly:

```powershell
repowiki config set endpoint https://api.openai.com/v1
repowiki config set model gpt-4o
repowiki config set key <your-api-key>
```

View current configuration:

```powershell
repowiki config get
```

Configuration is saved to:

```text
~/.repowiki/config.json
```

Environment variables are also supported:

```text
REPOWIKI_API_KEY
REPOWIKI_BASE_URL
REPOWIKI_MODEL
OPENAI_API_KEY
OPENAI_BASE_URL
```

## Commands

```powershell
repowiki generate [path]
```

Generate wiki documentation for a project.

Useful options:

```text
-o, --output <dir>       Output directory
-m, --model <model>      Override model name
-c, --concurrency <n>    LLM request concurrency
--skip-llm               Use local-only generation
--json-stdout            Stream progress as JSON Lines
```

```powershell
repowiki scan [path] --pretty
```

Run local static analysis and print the raw JSON result.

```powershell
repowiki config get
repowiki config set <key> <value>
```

Manage global LLM configuration.

```powershell
repowiki login
```

Interactive setup for endpoint, model, and API key.
