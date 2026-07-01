# Incremental Update (Auto-Update Workflow)

This is the "自动更新" behavior: when a wiki already exists, regenerate only the pages whose source files changed, and do nothing when nothing changed. It is driven by each page's `dependent_files` (the dependency graph) plus a stored fingerprint of those files.

## When this runs

Phase 0 of SKILL.md routes here whenever `.repowiki/<lang>/meta/repowiki-metadata.json` exists. If it does not exist, do a full build instead and write the metadata so the *next* run can come here.

## Inputs

From `meta/repowiki-metadata.json`:
- `wiki_catalogs[]` — each with `id`, `name`, `dependent_files` (comma-separated paths), `gmt_modified`.
- `source_index` — map of `repo-relative path → fingerprint` captured at last generation (see metadata-schema.md). The fingerprint is a content hash (preferred) or `mtime:size`.
- `generated_at_commit` — optional git SHA at last generation (fast-path).

## Algorithm

### Step 1 — Compute the changed-files set
Two strategies; use git when available, else hashing. Both produce a set `CHANGED` of repo-relative paths plus `DELETED` and `ADDED` subsets.

**Git fast-path** (repo has `.git` and metadata has `generated_at_commit`):
```
git diff --name-status <generated_at_commit> HEAD     # M/A/D per file
git status --porcelain                                  # include uncommitted edits
```
Map statuses: `M`→CHANGED, `A`→ADDED, `D`→DELETED, `R`→both (old DELETED, new ADDED).

**Portable hash path** (no git, or no stored commit): for every path in `source_index`, recompute its current fingerprint and compare:
- present + fingerprint differs → CHANGED
- present in repo but missing from `source_index` and inside a covered area → ADDED (candidate)
- in `source_index` but file no longer exists → DELETED

Only files that are some page's `dependent_files` need hashing for staleness; hash the whole tracked set if you also want to discover ADDED files in covered areas.

### Step 2 — Reverse-lookup stale pages
For each catalog page, split its `dependent_files` into a list. The page is **stale** iff:
- any of its dependent files ∈ CHANGED, **or**
- any of its dependent files ∈ DELETED (page may need rewrite or pruning).

Build `STALE = { pages with ≥1 changed/deleted dependency }`.

Also compute:
- `ORPHANED` — pages **all** of whose dependent files were DELETED → the documented thing is gone; propose removing the page (and its catalog node + relation), don't silently keep stale docs.
- `UNCOVERED` — ADDED files / new top-level dirs not referenced by any page's `dependent_files` → candidates for **new** pages. Surface these; only auto-create pages for clearly significant new modules, otherwise list them and ask.

### Step 3 — Decide
- `STALE` empty **and** no `UNCOVERED` worth acting on → **report "up to date", make no changes, stop.**
- Otherwise continue.

### Step 4 — Regenerate only what's needed
- For each page in `STALE`: re-read its (current) `dependent_files`, re-run Phase 3 generation against the new contents, overwrite just that `content/.../<title>.md`. Keep its `id`/`parent_id`/position stable.
- For `ORPHANED`: delete the `.md`, remove the catalog entry and its `knowledge_relations` edge (confirm with user if it's a parent with children).
- For `UNCOVERED` you decide to document: add new catalog node(s) + relation(s), generate the page(s).
- Cascade rule: if a change alters the **architecture overview** (new package, removed subsystem, changed entry point), also regenerate the overview page and the affected section landing pages, since they summarize children.

### Step 5 — Refresh metadata
For every regenerated/added page: update `gmt_modified`, and update `source_index` entries for its dependent files to the new fingerprints. Update `generated_at_commit` to current HEAD if git is present. Keep untouched pages and their fingerprints exactly as they were. Write the metadata back.

## Reporting

Always end with a short summary of what the update did, e.g.:
```
RepoWiki (en) update:
  changed files: 4   stale pages: 3 regenerated
  - Storage System         (db.ts, schema.ts changed)
  - Architecture Overview  (cascade: new package)
  - Core Packages          (cascade)
  orphaned: 0   new pages: 1 (Function Package — new packages/function/)
  untouched: 38 pages
```
If nothing changed: `RepoWiki (en) is up to date — 42 pages, no source changes since <commit/time>. No action taken.`

## Notes & edge cases

- **Granularity is per-page, not per-line.** A single changed file restamps every page that lists it. Keep `dependent_files` tight so updates stay surgical — over-broad dependency lists cause needless regeneration.
- **Line numbers drift.** Even an unchanged page that *cites* a changed file may now have wrong line ranges. Since the page is stale (its dependency changed), regeneration fixes citations automatically — this is a reason to regenerate on any dependency change rather than only on "semantic" change.
- **Manual edits.** If a user hand-edited a `content/*.md`, regeneration overwrites it. If preserving manual edits matters, check for a `manual_lock: true` flag you store in that catalog's `extend` and skip locked pages (warn that they may be stale).
- **Language scope.** Run the whole algorithm per `<lang>`. Updating `en` does not touch `zh` and vice-versa; each tree has its own metadata and may have a different catalog, so map changed files through *that* tree's `dependent_files`.
