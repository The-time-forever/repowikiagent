# Metadata Schema (optional machine-readable index)

If the user wants the wiki to be re-generatable / machine-readable, emit `meta/repowiki-metadata.json`. This is a structured, machine-readable RepoWiki metadata format. Skip it for readable-docs-only requests.

## Top-level shape

```json
{
  "wiki_repo":        { "id": "<uuid>", "name": "<repo name>", "progress_status": "completed", "wiki_present_status": "COMPLETED", "optimized_catalog": "<repo directory tree as text>" },
  "wiki_catalogs":    [ /* one entry per page; see below */ ],
  "knowledge_relations": [ /* PARENT_CHILD edges; see below */ ],
  "wiki_items":       [ /* lightweight per-catalog display records */ ],
  "wiki_overview":    { "id": "<uuid>", "repo_id": "<repo uuid>", "content": "<overview markdown, may be wrapped in <blog>...</blog>>" },
  "wiki_readme":      { "id": "<uuid>", "repo_id": "<repo uuid>", "content": "<readme/index markdown>" },
  "lang":             "en",
  "generated_at_commit": "<git SHA at last generation, or null>",
  "source_index":     { "packages/opencode/src/storage/db.ts": "<fingerprint>", "...": "..." }
}
```

### `source_index` — change-detection fingerprints (required for auto-update)

This is the dependency-graph fingerprint that powers incremental updates (`references/incremental-update.md`). It maps every file that appears in any page's `dependent_files` to a fingerprint captured at generation time:

- **Fingerprint** = a content hash (preferred, e.g. first 16 hex of sha256) so changes are detected even without git. A `mtime:size` string is an acceptable cheaper fallback but is less reliable across clones/checkouts.
- On an update run, recompute each file's fingerprint and compare to `source_index`; mismatches/missing/extra entries yield the CHANGED/DELETED/ADDED sets used to find stale pages.
- Keep it in sync: when a page is regenerated, refresh the fingerprints of *its* dependent files; leave others untouched.
- `generated_at_commit` lets a git repo skip hashing via `git diff <sha> HEAD`; store `null` when the project isn't a git repo and rely on `source_index` hashing.

`lang` records which language tree this metadata belongs to (each `<lang>` directory has its own metadata file).

## `wiki_catalogs[]` — the heart of it

Each page is one catalog entry:

```json
{
  "id": "<uuid>",
  "repo_id": "<repo uuid>",
  "name": "记忆存储架构",
  "description": "memory-storage-architecture",
  "prompt": "创建记忆存储架构的详细技术文档。深入解释基于 SQLite 的存储引擎设计……",
  "parent_id": "<parent catalog uuid, omit/empty for roots>",
  "layer_level": 1,
  "progress_status": "completed",
  "dependent_files": "packages/opencode/src/storage/db.ts,packages/opencode/src/storage/storage.ts",
  "gmt_create": "<ISO-8601 timestamp>",
  "gmt_modified": "<ISO-8601 timestamp>"
}
```

- `dependent_files` is a **comma-separated string** (not an array) of repo-relative paths.
- `description` is the kebab-case English slug; also used to derive the on-disk filename (the human title `name` is the actual `.md` filename in the export).
- Some wiki exporters also carry an encrypted `raw_data` ("WikiEncrypted:…") field holding the rendered page. **Do not reproduce that** — the readable Markdown lives in `content/`. Leave it out.

## `knowledge_relations[]` — the tree edges

One edge per parent→child link:

```json
{
  "id": 552,
  "source_id": "<parent catalog uuid>",
  "target_id": "<child catalog uuid>",
  "source_type": "WIKI_ITEM",
  "target_type": "WIKI_ITEM",
  "relationship_type": "PARENT_CHILD",
  "extra": "Wiki parent-child relationship: <parent> -> <child>",
  "gmt_create": "<ISO-8601>",
  "gmt_modified": "<ISO-8601>"
}
```

The relations must be consistent with each catalog's `parent_id`. Together they define the topic tree.

## `wiki_items[]` — display records

A thin per-catalog record for the wiki UI:

```json
{
  "catalog_id": "<catalog uuid>",
  "id": "<uuid>",
  "repo_id": "<repo uuid>",
  "title": "快速开始",
  "description": "getting-started",
  "extend": "{}",
  "progress_status": "completed",
  "reference_count": 0,
  "gmt_create": "<ISO-8601>",
  "gmt_modified": "<ISO-8601>"
}
```

## Generation notes

- Use any stable UUIDs (deterministic from slug is fine). Timestamps: the harness blocks `Date.now()` inside workflow scripts, but in normal tool use you can get the current time via a shell command, or just use the date provided in context.
- `optimized_catalog` is a plain-text directory tree of the repo (like `tree` output). It is the scan artifact that seeds catalog planning.
- Keep `wiki_catalogs`, `knowledge_relations`, and the on-disk `content/` files in sync: every catalog ⇒ one Markdown file; every non-root catalog ⇒ one PARENT_CHILD relation.
