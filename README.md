# RepoWiki Agent

[![npm version](https://img.shields.io/npm/v/repowiki-agent.svg)](https://www.npmjs.com/package/repowiki-agent)
[![npm package](https://img.shields.io/badge/npm-repowiki--agent-cb3837)](https://www.npmjs.com/package/repowiki-agent)

English | [简体中文](README.zh-CN.md)

RepoWiki Agent is a local-first CLI for generating Markdown wiki documentation from a code repository. It scans the project structure, detects technology stacks, plans a hierarchical topic tree, and writes a multi-page, **source-grounded** wiki under `.repowiki/<lang>/`.

Highlights:

- **Grounded citations** — every code-related section cites real `file://path#Lstart-Lend` line ranges, validated against the scanned files (invalid citations trigger a corrective retry).
- **Hierarchical catalog** — an overview → sections → per-module/per-API topic tree, with section landing pages.
- **Bilingual** — generate `zh`, `en`, or `both`; all labels and diagrams are language-driven.
- **Incremental updates** — re-running only regenerates pages whose source files changed (via a metadata dependency graph); nothing changes when nothing changed.

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

By default, output is written per language under:

```text
.repowiki/<lang>/content/   # the wiki pages
.repowiki/<lang>/meta/repowiki-metadata.json   # dependency graph for incremental updates
```

For example `.repowiki/en/`. Generate a specific language (or both):

```powershell
repowiki generate . --lang zh
repowiki generate . --lang both
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
-o, --output <dir>       Output root (default: <path>/.repowiki; language trees live under <root>/<lang>)
-m, --model <model>      Override model name
-c, --concurrency <n>    LLM request concurrency (now actually parallelizes analysis and page generation)
-l, --lang <lang>        Documentation language: zh | en | both (default: en)
-s, --strategy <s>       Catalog organization: feature | package (default: feature)
--force-rebuild          Full rebuild, ignoring incremental updates from existing metadata
--skip-llm               Use local-only generation
--json-stdout            Stream progress as JSON Lines
```

### Incremental updates

After the first run, a `.repowiki/<lang>/meta/repowiki-metadata.json` records each page's `dependent_files` plus a content fingerprint. Re-running `repowiki generate` detects changed files (via `git` when available, else content hashing), reverse-looks-up the affected pages, and regenerates **only those** — leaving every unchanged page untouched. When nothing changed, it reports "up to date" and writes nothing. Use `--force-rebuild` to bypass this and regenerate everything.

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
