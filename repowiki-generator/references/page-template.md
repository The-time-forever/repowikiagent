# Page Template

Every content page follows this exact skeleton. Headings shown in Chinese (zh); English equivalents in parentheses — pick one language per wiki and stay consistent.

## Skeleton

```markdown
# {页面标题}

<cite>
**本文档引用的文件**
- [path/to/file.ts](file://path/to/file.ts)
- [another/file.ts](file://another/file.ts)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖分析](#依赖分析)
7. [性能考量](#性能考量)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录](#附录)   ← optional

## 简介
{What this page covers, in prose + bullets. Plain explanation for newcomers, enough depth for experts.}

## 项目结构
{How the relevant files/folders are organized. Usually followed by a structural Mermaid diagram.}

​```mermaid
graph TB
IDX["index.ts<br/>统一导出"] --> DB["db.ts<br/>连接/事务"]
DB --> SCHEMA["schema.ts<br/>表定义"]
​```

**图表来源**
- [path/to/index.ts:1-27](file://path/to/index.ts#L1-L27)
- [path/to/db.ts:1-173](file://path/to/db.ts#L1-L173)

**章节来源**
- [path/to/index.ts:1-27](file://path/to/index.ts#L1-L27)

## 核心组件
{The key building blocks this page documents.}

**章节来源**
- [path/to/file.ts:30-120](file://path/to/file.ts#L30-L120)

## 架构总览
{High-level architecture, with a diagram showing data/control flow.}

**图表来源**
- ...

## 详细组件分析
{Per-component deep dives. Use sub-headings (###) per component. Sequence/flow diagrams where interaction matters.}

### {组件 A}
​```mermaid
sequenceDiagram
participant U as "用户"
participant Main as "主流程"
U->>Main : "调用"
Main-->>U : "返回"
​```

**图表来源**
- ...

**章节来源**
- ...

## 依赖分析
{Internal/external dependencies, import graph.}

**章节来源**
- ...

## 性能考量
{Performance notes. If not tied to specific code:}
[本节为通用指导，无需列出章节来源]

## 故障排查指南
{Common issues + fixes, grounded in error-handling code where possible.}

**章节来源**
- ...

## 结论
{Summary.}
[本节为总结性内容，无需列出章节来源]

## 附录
{Optional: quick-start, config tables, glossary.}
```

## Rules for the template

- **`<cite>` block**: list every file the page references, as `file://` links (no line numbers here — just the file).
- **`## 目录`**: a numbered TOC with anchor links matching the section headings.
- **Section selection**: not every page needs all 10 sections. A focused page (e.g. "代理创建") may use 简介 / 核心组件 / 详细组件分析 / 依赖分析 / 结论. Always keep 简介 and at least one source-cited body section. The overview page tends to use all sections.
- **`**图表来源**`** (Diagram Sources): appears immediately after each Mermaid block; lists the files+line-ranges the diagram was derived from.
- **`**章节来源**`** (Section Sources): appears at the end of each code-grounded section; lists files+line-ranges backing the prose.
- **Citation format**: `[relative/path:Lstart-Lend](file://relative/path#Lstart-Lend)`. Line numbers must be real spans you read. For whole-file references use the file's actual length.
- **Mermaid node labels**: use `"<br/>"` for line breaks inside nodes; quote labels containing spaces or CJK. Keep diagrams faithful to the code.
- **Placeholder lines**: use `[本节为通用指导，无需列出章节来源]` / `[本节为总结性内容，无需列出章节来源]` for advisory/summary sections with no specific source.

## English (en) variant — verified against the reference wiki

The English wiki uses the **identical structure**, with these exact labels. Use this set verbatim for `en` output:

| element | Chinese (zh) | English (en) |
|---------|--------------|--------------|
| cite header | `**本文档引用的文件**` / `**本文引用的文件**` | `**Referenced Files in This Document**` |
| TOC heading | `## 目录` | `## Table of Contents` |
| sections | 简介 · 项目结构 · 核心组件 · 架构总览 · 详细组件分析 · 依赖分析 · 性能考量 · 故障排查指南 · 结论 · 附录 | Introduction · Project Structure · Core Components · Architecture Overview · Detailed Component Analysis · Dependency Analysis · Performance Considerations · Troubleshooting Guide · Conclusion · Appendices |
| diagram sources | `**图表来源**` | `**Diagram sources**` |
| section sources | `**章节来源**` | `**Section sources**` |
| generic placeholder | `[本节为通用指导，无需列出章节来源]` | `[This section is general guidance; no sources required]` |
| summary placeholder | `[本节为总结性内容，无需列出章节来源]` | `[This section provides a summary; no sources required]` |

Per-language conventions observed in the reference:
- **TOC anchors** are GitHub-style: lowercase, spaces→hyphens. en `## Detailed Component Analysis` → `#detailed-component-analysis`. zh anchors keep the Chinese text (`#详细组件分析`).
- **cite-block link text**: en commonly uses the **basename** (`[index.ts](file://packages/opencode/src/storage/index.ts)`); zh commonly uses the **full relative path** as link text. Either is acceptable — keep it consistent within a wiki. The `file://` target is always the full repo-relative path.
- **Citations without a line range** are allowed when referencing a whole file generically (`[cli/cmd/db.ts](file://packages/opencode/src/cli/cmd/db.ts)`), but prefer line ranges whenever you cite a specific claim.

Keep one language per wiki. If the user wants both, generate two trees under `.repowiki/zh/` and `.repowiki/en/` — they may legitimately differ in catalog organization (see catalog-structure.md).

> Note: the `​` zero-width characters before the example ```` ``` ```` fences above are only to keep this template file itself valid Markdown. Write normal fenced ```` ```mermaid ```` blocks in real pages.
