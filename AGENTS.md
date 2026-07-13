# RepoWiki Agent — 项目规范（面向所有协作者与 AI 编程工具）

任何 IDE / AI 工具接手本仓库前先读完本文件，规范以此为准。

## 项目定位

本地运行的代码知识库生成 Agent：分析本地仓库（代码不上云），生成多页面、可追溯源码引用的项目 Wiki，并提供基于 Wiki 的问答（CLI / TUI / VS Code）。

## Monorepo 布局（pnpm workspace）

| 目录 | npm 包名 | 职责 |
|------|----------|------|
| `packages/core` | `repowiki-core` | 全部核心逻辑：扫描、目录规划、LLM 客户端（流式 SSE + 空闲超时）、生成管线、增量更新、引用校验与清洗、dry-run 估算、问答检索 |
| `packages/cli` | `repowiki-agent`（bin: `repowiki`） | CLI 命令（generate/ask/chat/login…）与 ink TUI |
| `packages/vscode-extension` | 不发 npm，打包 .vsix | VS Code 侧边栏与 chat 面板 |

## 构建与测试（铁律：先 build 后 test）

```bash
pnpm install && pnpm -r build && pnpm -r typecheck && pnpm -r test
```

单测直接 import `packages/core/dist/index.js`（测编译产物），且 cli/extension 的 typecheck 依赖 core 的 dist 类型——**顺序不可调换**。详细测试方法（冒烟矩阵、脚本、伪 TTY 测法）见 `docs/TESTING.md`。

## 代码约定

1. **模块系统**：ESM + TypeScript `module: Node16` —— **相对导入必须写 `.js` 后缀**（`import { x } from './foo.js'`），漏写在编译后运行时才报错。
2. **缩进**：4 空格。
3. **i18n**：所有用户可见文案（CLI 输出、TUI、生成页面中的固定文案、提示词）必须走 zh/en 双语机制（core 的 labels / prompt-manager 双模板），不得硬编码单语言字符串。
4. **LLM 相关测试一律 mock fetch**，不发真实请求；真实端点冒烟是发布前的独立流程（见 TESTING.md）。
5. 新公开 API 需在 `packages/core/src/index.ts` re-export，供 cli 与测试使用。

## 版本与发布

- `core` 与 `cli` 版本号同步升级（当前 0.6.0）；`vscode-extension` 独立（0.4.0）；根 package.json 为 private，版本不随发布走。
- 发布：在各包目录 `pnpm publish --access public`（`workspace:*` 依赖会自动改写为真实版本号）。
- **发布 npm、推送 GitHub、打 tag 必须等用户明确指示，不得自行执行。** 提交 commit 可以在完成任务后正常进行。

## 安全红线（违反 = 事故）

以下内容**永远不允许**出现在 git 跟踪的文件或提交里：

- `.env`（真实 LLM API key）、`.npmrc`（npm token）
- `~/.repowiki/config.json` 的内容（用户真实端点/key）
- `.repowiki/`（生成产物）、`test-reports/`（含 token 用量等本地实测数据）、`*.vsix`、`requirements/`

**提交前自查**：`git diff --cached --stat` 检查暂存清单，并 grep 暂存内容确认无上述文件与密钥字样。以上均已在 `.gitignore`，但新增文件时仍需留意。

## 文档去哪儿找 / 放哪儿

- `docs/TESTING.md` —— 测试方法（git 跟踪）。
- `requirements/` —— 需求文档与内部资料，**整体 gitignore**。约定：文件名带 `.done` 后缀 = 该需求已实现完毕，**无需阅读**，按文件名跳过即可；目录内 README 有完整约定。
- 本机特定配置（网络代理、密钥位置等）见 `requirements/local-notes.md`（如存在）——那些信息不进跟踪文件。
