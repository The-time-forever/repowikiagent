---
name: repowiki-generator
description: Generate a comprehensive, evidence-grounded documentation wiki for a codebase, in a structured RepoWiki style. Use when the user wants to "generate a repowiki", "create a repo wiki / codebase wiki / architecture documentation", document an existing repository, reverse-engineer and explain a project's architecture, or produce hierarchical Markdown docs with Mermaid diagrams and per-file source citations. Works for any language/framework and supports Chinese (zh) or English (en) output.
---

# RepoWiki Generator

Produce a structured, multi-page documentation wiki for a repository. Every page is **grounded in actual source files** and cites them with line ranges — never write from memory or assumption. The output uses a structured `.repowiki` format: a hierarchical catalog of topic pages, each following a fixed template with Mermaid diagrams and `图表来源`/`章节来源` (Diagram/Section sources) citation blocks.

## Phase 0 — Detect existing wiki & choose mode (always run this first)

Before generating anything, check whether a wiki already exists for the target language and decide what to do. This is what makes the skill idempotent and cheap to re-run.

1. Look for `.repowiki/<lang>/meta/repowiki-metadata.json`.
   - **Not found** → first-time build. Proceed to Phase 1 (full generation). Emit metadata in Phase 4 so future runs can update incrementally.
   - **Found** → enter **incremental-update mode**: do NOT regenerate everything. Follow `references/incremental-update.md`. In short:
     1. Load the metadata (catalog tree + each page's `dependent_files` + stored `source_index` fingerprints).
     2. Detect which source files changed since last generation (git diff fast-path, else content-hash comparison).
     3. **Reverse-lookup**: a page is *stale* iff any of its `dependent_files` is in the changed set. Also flag pages whose dependent files were deleted, and new/uncovered areas that may need brand-new pages.
     4. If the stale set is empty → **report "wiki is up to date" and stop. Change nothing.**
     5. Otherwise regenerate **only** the stale pages (Phase 3 for each), refresh their `gmt_modified` + fingerprints, rewrite just those `content/*.md` files and the metadata. Leave every unchanged page untouched.

Only fall through to the full pipeline below when there is no existing wiki (or the user explicitly asks for a clean rebuild).

## The pipeline (4 phases)

Follow these in order. Do not skip grounding.

### Phase 1 — Scan the repository
1. Build the directory tree (`rg --files` or a tree listing). Note the package/monorepo layout, entry points, and config files (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, etc.).
2. Read the top-level `README*`, `AGENTS.md`/`CONTRIBUTING.md`, and the main entry file. These anchor the overview.
3. Identify the major subsystems (e.g. CLI, storage, agents, context, providers, API). Each subsystem becomes one or more catalog pages.

### Phase 2 — Plan the catalog (topic tree)
Design a **hierarchical tree** of pages before writing any. See `references/catalog-structure.md` for the standard top-level catalogs and how to nest. For each planned page define:
- **title** — display name (e.g. "记忆存储架构" / "Memory Storage Architecture").
- **slug** — kebab-case English used for the file/folder name's English description.
- **prompt** — one paragraph describing exactly what the page must explain (scope, depth, audience).
- **dependent_files** — the *specific* source files the page must be grounded in. A page covers only what these files support.

Choose an organizing strategy — **feature/concept-centric** or **package/module-centric** (see `references/catalog-structure.md`; the reference wiki used feature-centric for zh and package-centric for en). Confirm the catalog with the user (or proceed if they asked for a full auto-generation).

**Language**: this skill generates `zh` (Chinese) or `en` (English) on demand.
- Pick the language from the user's request; if unstated, infer from the repo's primary doc language (default `en`, or `zh` if the repo is Chinese-first); if the user wants both, generate two trees, one per language.
- Output root: `.repowiki/<lang>/content/`. Every page's headings, TOC label, cite header, and source-citation labels switch with the language — use the exact bilingual label table in `references/page-template.md`. Keep one language consistent within each tree.

### Phase 3 — Generate each page
For every catalog node, **read its dependent_files first**, then write the page strictly following `references/page-template.md`. Hard rules:
- Cite real line ranges. Open the file, find the relevant span, and cite `[path:Lstart-Lend](file://path#Lstart-Lend)`. Never fabricate line numbers.
- Every section that makes claims about code ends with a `**章节来源**` block. Every Mermaid diagram is followed by a `**图表来源**` block.
- Diagrams (`graph TB`, `sequenceDiagram`, `flowchart TD`, `classDiagram`, `erDiagram`) must reflect the real structure found in the files, not a generic template.
- Generic/advisory sections (Performance, Conclusion) that aren't tied to specific code use the placeholder line `[本节为通用指导，无需列出章节来源]` (zh) or `[This section is general guidance; no sources required]` (en).
- Write in the page's language consistently. Use the codebase's own terminology.

Generate pages parent-first so cross-links resolve. Place each page at `content/<分类路径>/<页面标题>.md`.

### Phase 4 — Overview, README, and metadata
1. Write a top-level **overview** page (the project's architecture story) and a **wiki README** index linking all pages.
2. Emit `meta/repowiki-metadata.json` capturing the catalog tree + relations + the **`source_index`** fingerprints — see `references/metadata-schema.md`. The metadata is the dependency graph that powers Phase 0's incremental updates, so **emit it whenever the user might re-run the skill** (the default). Only skip it for a one-off, throwaway export the user will never refresh — and tell them auto-update won't be possible without it.

## Grounding discipline (most important rule)

The single thing that separates a real repowiki from generic AI docs: **every factual claim traces to a file:line you actually read.** If you cannot cite it, either go read the file or don't write the claim. Resource numbers, timing data, API signatures, config keys, and class relationships must come from the source — never invent them.

## Quality checklist

Before declaring done:
- [ ] Catalog is a coherent tree (overview → subsystems → deep-dives), no orphan pages.
- [ ] Every page has: `# title`, `<cite>` file list, `## 目录` TOC, the standard sections, ≥1 Mermaid diagram where structure warrants it, and source-citation blocks.
- [ ] All `file://` citations point to files that exist; all line ranges are real.
- [ ] Diagrams render (valid Mermaid) and depict the actual code, not placeholders.
- [ ] Language is consistent; terminology matches the codebase.
- [ ] (If metadata emitted) catalog ids and parent/child relations are internally consistent.

See `references/page-template.md` for the exact page skeleton and `references/catalog-structure.md` for planning the tree.
