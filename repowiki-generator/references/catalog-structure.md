# Catalog Structure (Planning the Topic Tree)

The wiki is a **tree** of pages. Plan it before writing. A node = one Markdown page. Parents are broad; children drill into specifics.

## Two valid organizing strategies

The reference wiki used a **different tree for each language**, which is fine — the catalog is a design choice, not fixed:

- **Feature/concept-centric** (the zh reference, 55 pages): top sections are capabilities — `项目概览`, `核心功能`, `架构设计`, `记忆系统`, `API 参考`. Best when the *what it does* matters more than *where the code lives*. Good for product/user-facing wikis.
- **Package/module-centric** (the en reference, 42 pages): top sections mirror the repo layout — `Project Overview`, `Getting Started`, `Core Features`, `Architecture & Design`, `Packages & Modules` (→ `Core Packages` → `Opencode Package` → `Storage System`, `Agent System`…), `API Reference`, `Development Guide`, `Deployment & Operations`, `Troubleshooting & Support`. Best when the repo is a monorepo and contributors navigate by package. Good for developer/contributor wikis.

Pick one per language. Ask the user, or default to **package-centric for monorepos / contributor docs** and **feature-centric for product/overview docs**. When generating both zh and en, you may use the same tree translated, or deliberately use each strategy for its language — the reference did the latter.

## Standard top-level catalogs (feature-centric)

Most repos map well onto these top-level sections (adapt to the actual project — drop what doesn't apply, add domain-specific ones). For the **package-centric** alternative, see the en list under "Two valid organizing strategies" above (`Packages & Modules` → `Core Packages` → per-package → per-subsystem):

1. **项目概览 / Project Overview** — what the project is, value proposition, relationship to upstream/forks, tech stack at a glance.
   - children: 架构概览, 核心特性 (one child per headline feature), 社区生态.
2. **快速开始 / Getting Started** — install, first run, configuration.
3. **核心功能 / Core Features** — one page per major capability (e.g. 多代理系统, 持久记忆系统, 上下文管理, 任务跟踪).
4. **架构设计 / Architecture** — system architecture, tech stack, and:
   - **模块设计 / Module Design** — one page per code module (storage, agent, context, provider, plugin, session…). The agent/large modules can nest further (代理创建, 代理管理, 代理工具系统…).
   - **集成模式 / Integration Patterns** — MCP, TUI, Web, desktop, plugin ecosystem.
5. **API 参考 / API Reference** — CLI commands, HTTP API, WebSocket, MCP protocol, TUI protocol — one page each.
6. **记忆系统 / Subsystem deep-dives** — when a subsystem is rich, give it its own top-level section with pages like 存储架构, 数据模型, 查询与性能, 注入与恢复.
7. **开发指南 / Development**, **部署指南 / Deployment**, **配置指南 / Configuration**, **故障排除 / Troubleshooting** — operational guides.

## How to size the tree

- Small repo (≤ ~20 source files): 5–10 pages, 1–2 levels deep.
- Medium: 15–30 pages, 2–3 levels.
- Large monorepo (the MiMo-Code reference had **55** pages): 40–60 pages, 3–4 levels, with per-module and per-API-surface pages.

Let the repo's real structure drive depth. One page per genuine subsystem or public surface; don't split a thing that fits on one page, don't cram three subsystems onto one page.

## Per-node planning fields

For each node, decide and record (in your plan, and in metadata if emitting it):

| field | meaning | example |
|-------|---------|---------|
| `name` / title | display heading | `记忆存储架构` |
| `description` / slug | kebab-case English; becomes the filename | `memory-storage-architecture` |
| `prompt` | precise generation brief: scope, depth, audience | "Explain the SQLite-based storage engine: connection mgmt, schema/index design, drizzle-orm usage, transaction handling, error mapping. Include code examples and perf/extensibility notes." |
| `dependent_files` | exact source files to ground in (comma-separated) | `src/storage/db.ts,src/storage/schema.ts,src/storage/json-migration.ts` |
| `parent_id` | parent node (omit for roots) | overview node id |
| `layer_level` | depth (0 = top) | `1` |

The `prompt` is what an LLM (you) consumes to write the page; `dependent_files` is the grounding boundary. **A page only states what its dependent_files support.** If you need facts from another file, add it to dependent_files (and to the page's `<cite>` block).

## File layout on disk

```
.repowiki/<lang>/
  content/
    项目概览/
      项目概览.md            ← the section's own landing page (same name as folder)
      架构概览.md
      核心特性/
        核心特性.md
        多代理系统.md
        持久记忆系统.md
    架构设计/
      架构设计.md
      模块设计/
        存储模块.md
        代理模块/
          代理模块.md
          代理创建.md
    API 参考/
      API 参考.md
      CLI 命令.md
  meta/
    repowiki-metadata.json   ← optional, see metadata-schema.md
```

Convention: a section that has children gets its own landing page named after the section (e.g. `项目概览/项目概览.md`), which introduces the section and links to its children.

## Determining dependent_files

For a page about subsystem X:
1. `rg`/glob for the subsystem's directory and entry files.
2. Include: the module's index/entry, its core implementation files, its schema/types, its tests (tests reveal intended behavior), and the config/wiring that uses it.
3. Read them. Trim to the files that actually inform the page. Over-grounding (citing files you didn't read) is worse than a tighter, honest set.

### Keep `dependent_files` precise — it controls update cost

`dependent_files` is also the **dependency graph** for auto-update (`references/incremental-update.md`): when a file changes, every page that lists it gets regenerated. So the list is a precision/cost tradeoff, not just a citation aid:

- **Tighter is better.** List only files the page genuinely documents. A page that needlessly lists `package.json` or a shared util will regenerate on every unrelated bump to those files — wasted work and churned line numbers.
- **But don't under-list.** Every file the page makes claims about (and cites in its `<cite>` block) must be in `dependent_files`, or a real change to it will be missed and the page goes silently stale. Rule of thumb: `dependent_files` ≈ the page's `<cite>` set.
- **Avoid one page depending on a huge shared file** that many things touch — it will be the noisiest trigger. If a page only needs one function from a big file, that's fine, but expect it to restamp whenever that file changes (line-number drift alone justifies it).
- **Don't overlap pages onto the same files unnecessarily.** If two pages both list the same five files, both regenerate together; split responsibilities so each file belongs to the page that truly owns it.

Net effect: precise, minimally-overlapping dependency lists make incremental updates surgical (a code change touches the 1–3 pages that actually document it), while sloppy/over-broad lists make every update cascade.
