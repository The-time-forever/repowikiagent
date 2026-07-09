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
--dry-run                Estimate cost only (pages, LLM calls, tokens) — no LLM calls, no writes
--slug-filenames         ASCII slug filenames (cross-platform / URL friendly)
--skip-llm               Use local-only generation
--json-stdout            Stream progress as JSON Lines
```

### Cost estimation (dry run)

Before spending tokens, preview what a run would cost:

```powershell
repowiki generate . --dry-run
```

This prints a per-page table (grounded files, estimated input/output tokens) and totals, with zero LLM calls and zero writes. With existing metadata it estimates the incremental update instead of a full build.

### Incremental updates

After the first run, a `.repowiki/<lang>/meta/repowiki-metadata.json` records each page's `dependent_files` plus a content fingerprint. Re-running `repowiki generate` detects changed files (via `git` when available, else content hashing), reverse-looks-up the affected pages, and regenerates **only those** — leaving every unchanged page untouched. When nothing changed, it reports "up to date" and writes nothing. Use `--force-rebuild` to bypass this and regenerate everything.

The catalog also evolves: files added to a directory an existing page covers are assigned to that page; a **new directory** with 2+ files automatically becomes a new page under the modules section, and the sidebar/home index is refreshed accordingly.

### Ask questions about your codebase

Once a wiki exists, query it with source-grounded answers:

```powershell
repowiki ask "How does incremental update work?"
repowiki chat          # multi-turn REPL, /exit to quit
```

Retrieval runs locally over the generated wiki (no vector DB); answers cite page names and `file://path#L10-L42` source references. Answers stream token-by-token in `ask`, `chat`, and the TUI; all LLM requests use streaming under the hood, so `timeoutMs` acts as an **idle timeout** (max gap between chunks) rather than a whole-request limit — long generations no longer race a fixed clock. Endpoints without SSE support fall back to non-streaming automatically.

### Interactive terminal UI (TUI)

```powershell
repowiki            # bare command in an interactive terminal = enter the TUI (guides generation if no wiki yet)
repowiki tui [path] # explicit entry; -l zh|en picks the language, -k <n> sets Q&A retrieval page count
```

Three-pane layout: wiki tree on the left (arrow keys to navigate, Enter to open), page content on the right (scrollable; press `r` for the reference list and Enter to open a cited source line in VS Code), and a chat box at the bottom (`a` asks about the current page, `A` asks the whole repo; answers cite pages and source lines). `/` searches pages, `u` runs an incremental update or force rebuild, `q` quits.

On startup, if the repo has commits newer than the recorded generation commit, the TUI offers a one-key incremental update; non-git projects are never auto-scanned (manual `u` only). In non-interactive contexts (pipes/CI) the bare `repowiki` still prints help, so scripts are unaffected.

### CI integration

Copy [`examples/github-actions/repowiki-update.yml`](examples/github-actions/repowiki-update.yml) into your project's `.github/workflows/` to incrementally update the wiki on every push to `main` and commit the result. Requires `REPOWIKI_API_KEY` in repo secrets, `fetch-depth: 0` (already in the template), and `.repowiki/` not being gitignored in your project.

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
