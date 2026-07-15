# VioletCode

[![发布质量门禁](https://github.com/Viviana-Luna/violetcode/actions/workflows/quality-gate.yml/badge.svg)](https://github.com/Viviana-Luna/violetcode/actions/workflows/quality-gate.yml)

VioletCode 是一个运行在终端中的 AI 编程助手，当前明确支持：

- DeepSeek：内置模型、思考模式、工具调用和 Provider 原生网页搜索。
- 火山方舟 Agent Plan：`ark-code-latest` 与自定义模型 ID；网页搜索可由用户独立配置 Exa。

当前版本：`v0.1.0`。本项目仍处于早期阶段，建议先在个人开发环境和非关键仓库中使用。

## 安装

目前提供基于 Git 源码的安装与显式更新，支持 macOS 和 Linux。需要预先安装：

- [Git](https://git-scm.com/)
- [Bun](https://bun.sh/) 1.3 或更高版本

```bash
git clone https://github.com/Viviana-Luna/violetcode.git
cd violetcode
./violet install
```

安装器会严格按 `bun.lock` 安装依赖，并在 `~/.local/bin/violet` 创建指向当前工作区的符号链接。如果该目录不在 `PATH`，请按安装器提示加入。之后可运行：

```bash
violet --version
violet --help
violet
```

默认配置目录为 `~/.violet`。可通过 `VIOLET_CONFIG_DIR` 指向独立配置目录。

## 更新

更新命令只接受干净的 Git 工作区，并使用快进合并，避免覆盖本地修改：

```bash
violet update --check
violet update
```

如果希望固定在某个发布版本，请检出对应标签后安装；标签检出属于固定版本，不支持 `violet update`：

```bash
git checkout v0.1.0
./violet install
```

## Provider 配置

启动后运行 `/connect`，分别配置模型 Provider 和可选搜索服务：

- DeepSeek API Key
- 火山方舟 Agent Plan API Key
- Exa API Key（仅在火山方舟需要网页搜索时使用）

凭据优先从 Provider 专属环境变量读取，其次读取权限受控的本地 `auth.json`。不要把 Key 写入代码、提交记录、Issue 或调试日志。

## 开发

```bash
# 开发启动
bun run dev

# 核心离线测试
bun run test:core

# 不允许新增类型诊断的增量门禁
bun run typecheck

# 查看完整既有类型债务；当前预期仍会失败
bun run typecheck:full

# 生产依赖漏洞审计
bun run security:audit

# 开发中运行完整发布门禁
bun run release:check:working
```

仓库当前继承了尚未清零的 TypeScript 诊断。`bun run typecheck` 会按文件锁定已知基线，任何新文件诊断或单文件诊断数上升都会失败；这不等于完整 `tsc` 已通过。基线只允许随真实修复向下更新。

## 发布

维护者应先更新 `package.json` 版本、提交全部改动，然后执行：

```bash
bun run release:check
./scripts/publish-github-release.sh
```

发布脚本会再次运行安全审计、核心测试、类型增量门禁、补丁格式、CLI 帮助和版本检查，然后通过 GitHub CLI 创建 `v<version>` Release。完整流程见 [docs/RELEASING.md](docs/RELEASING.md)。

## 项目结构

- `src/`：核心源码
- `test/`：Provider、网络、输入、查询生命周期和发布链路测试
- `scripts/`：安装、更新、检查与发布脚本
- `local-deps/`：当前运行所需的本地兼容依赖
- `macro-shim.cjs`：源码开发模式的构建宏兼容层
- `violet`：统一启动、安装与更新入口

## 安全与隐私

- VioletCode 不要求 Anthropic 账号，也不会把 DeepSeek、火山方舟或 Exa Key 互相转发。
- 火山方舟使用 Exa 搜索时，只向 Exa 发送搜索词和域名过滤条件，不发送会话全文或模型 Provider Key。
- 自动插件更新默认关闭；VioletCode 自身只在用户显式执行 `violet update` 时更新。
- 安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 Issue 中粘贴凭据。

## 来源与许可说明

VioletCode 是独立社区项目，与 Anthropic、DeepSeek、火山引擎和 Exa 均无隶属、背书或赞助关系。

本仓库包含源自 Anthropic Claude Code CLI 的代码，并吸收了 OpenClaude 的社区修改。VioletCode 贡献者新增和修改的部分，在法律允许且贡献者拥有相应权利的范围内按 MIT 条款提供；底层派生代码仍受其原权利人约束。本项目没有 Anthropic 对其专有源码分发的授权。使用者和贡献者应自行评估适用法律与分发风险。

详见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
