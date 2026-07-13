# RepoWiki 测试指南

本文档说明如何测试本仓库：单元测试、真实 key 冒烟测试、冒烟脚本与 CI。整理自 0.5.0 / 0.6.0 两轮发布前实测经验。

## 1. 单元测试

```bash
pnpm install
pnpm -r build      # 必须先 build！
pnpm -r typecheck
pnpm -r test
```

**为什么必须先 build**：单测全部位于 `packages/core/test/`（vitest），直接 import `../dist/index.js` 而非源码——测试对象是编译产物本身。不 build 或 dist 过期都会导致测试跑旧代码。core 的 `test` 脚本里的 `tsc` 只负责编译 core 自己；cli 与 vscode-extension 的 typecheck 又依赖 core 的 dist 类型，所以工作区级 `pnpm -r build` 放最前。

当前 88 个用例、16 个测试文件，覆盖分布（文件名即模块）：

- 扫描与结构：`file-scanner` / `tree-builder` / `catalog-builder` / `module-analyzer` / `symbol-extractor`
- LLM 客户端：`llm-usage`（用量累计）/ `llm-stream`（SSE 流式、空闲超时、非流式降级）/ `providers`
- 生成与质量：`sanitize`（占位行/幻觉元信息清洗）/ `citations` / `citation-validator` / `mermaid-lint`
- 其他：`incremental`（增量判定）/ `dry-run`（估算与校准）/ `retriever`（问答检索）/ `concurrency`

新增功能时的约定：测试写在 `packages/core/test/<模块>.test.ts`，从 `../dist/index.js` 导入公开 API（必要时先在 `src/index.ts` re-export）；LLM 相关测试一律 mock `fetch`，不发真实请求。

## 2. 真实 key 冒烟测试（发布前必做）

单测全程 mock LLM，发布前必须用真实端点跑一遍冒烟矩阵。

**Key 的来源（绝不入库）**：

- 交互使用：`repowiki login` 写入 `~/.repowiki/config.json`；
- 脚本使用：仓库根 `.env`（已 gitignore）。
- 两者都不允许出现在任何被 git 跟踪的文件里。测试涉及 login 流程时先备份 `~/.repowiki/config.json`，测完恢复。

**标准冒烟矩阵**（对本仓库自身跑，按序执行）：

| # | 场景 | 命令/方式 | 判定标准 |
|---|------|-----------|----------|
| 1 | dry-run 估算 | `repowiki generate . --dry-run` | 有历史 usage_stats 时输出"已按上次实测校准"，量级与上轮实测接近（±30%） |
| 2 | 全量或增量生成 | `repowiki generate .`（改动若干源文件后跑增量） | 正常完成；记录时长/调用数/token；引用校验兜底警告（"已保留尽力结果"）数量与既往趋势对比 |
| 3 | 质量抽查 | `node scripts/smoke/quality-check.mjs .` | badCount=0、mermaidErrors 空、placeholderHits 空、citeMetaHits 空 |
| 4 | metadata 用量回写 | 查看 `.repowiki/zh/metadata.json` 的 `usage_stats` | 与本轮实际调用数/token 一致 |
| 5 | ask 流式 | `node scripts/smoke/ask-stream-smoke.mjs packages/cli/dist/index.js .` | `streaming: true` 且 `hasSources: true` |
| 6 | chat 多轮 | 手动 `repowiki chat .` 两轮 + `/exit` | 每轮流式输出、带来源、退出干净 |
| 7 | TUI 流式问答 | `node scripts/smoke/tui-stream-smoke.mjs .` | `ok: true`（草稿帧递增 ≥3 个不同长度且最终带来源） |

**结果记录**：每轮实测在 `test-reports/REPORT.md` 追加一节（结果总表 + 发现并修复的问题 + 原始数据文件清单）。`test-reports/` 已 gitignore——其中含耗时与 token 用量等本地数据，只留本地，格式参考已有章节。

## 3. 冒烟脚本（scripts/smoke/）

三个脚本均需先 `pnpm -r build`，用法与判定标准见各文件头部注释：

- **quality-check.mjs** — 全量扫描生成的 wiki 页面：引用行号是否越界/文件是否存在、mermaid 语法、占位行残留、`<cite>` 块幻觉元信息（"文档版本/最后更新"等）。零 LLM 调用，秒级完成，可随时跑。
- **ask-stream-smoke.mjs** — 子进程跑 `repowiki ask`，按 stdout 分段到达时间判定是否真流式（分段 ≥5 且首末间隔 >1s）。需要真实 key。
- **tui-stream-smoke.mjs** — 伪 TTY 内嵌驱动 TUI 完成一轮问答，统计含流式光标 `▌` 的帧。需要真实 key。

**伪 TTY 测法注意点**（在 CI 或管道环境驱动 ink TUI 的通用做法，踩坑成果）：

1. 必须用 `PassThrough` **整体替换** `process.stdin`（`Object.defineProperty(process, 'stdin', {...})`），按键用 `fakeStdin.write()` 写入——对原生 stdin 手动 `emit('data')` 不会进入 ink 的按键管道，表现为界面完全不响应。
2. PassThrough 需补 `isTTY = true`、`setRawMode`、`ref`、`unref` 四个桩，否则 ink 启动即抛错。
3. 若仓库自上次生成后有变更，TUI 首帧会弹"更新 Wiki（增量）/跳过"选择框，先发 `Esc`（`\x1b`）关闭再继续按键。
4. 断言基于帧序列（拦截 `process.stdout.write` 收集），先 strip ANSI 再匹配文本。

## 4. CI（.github/workflows/ci.yml）

push 到 main 与 PR 触发，两个 job：

- **build-test**：pnpm install → `pnpm -r build` → `pnpm -r typecheck` → `pnpm -r test`（顺序不可调换，原因见第 1 节）。
- **package-extension**（依赖前者）：打包 VS Code 扩展并上传 .vsix artifact。

本地等价复现即第 1 节的四条命令。CI 不跑真实 key 冒烟（无密钥），冒烟属于发布前的本地流程。
