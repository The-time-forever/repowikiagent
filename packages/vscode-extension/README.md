# RepoWiki for VS Code

在编辑器内生成、浏览本地代码库 Wiki,并支持从文档一键跳转到被引用的源码行。

## 功能

- **生成 Wiki**:`RepoWiki: Generate Project Wiki` — 选择生成模式(大模型 / 免大模型)、语言(中文 / English / 双语)与更新方式(增量 / 全量),进度与警告写入 RepoWiki 输出面板。
- **目录树导航**:活动栏 RepoWiki 图标打开 Wiki 目录树,按章节层级展示,点击打开页面预览;生成或增量更新后自动刷新。
- **引用跳转**:Wiki 页面中的 `file://<path>#L10-L42` 引用可点击,直接打开源文件并选中对应行区间。
- **模型配置**:`RepoWiki: Configure Model Provider` — 配置 OpenAI 兼容端点、模型与 API 密钥(密钥掩码输入)。

## 数据说明

扫描与静态分析全部在本地执行。使用大模型生成时,会向所配置的 API 端点上传项目结构、模块摘要及被引用的源码片段;免大模型模式完全离线。

## 相关链接

- 仓库: <https://github.com/The-time-forever/repowikiagent>
- CLI: `npm install -g repowiki-agent`
