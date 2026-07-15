# VioletCode 二进制发布流程

## 发布范围

`v0.1.0-preview.1` 是未使用 Apple Developer ID 签名、未公证的 CLI 预览版。首发资产固定为：

- `violet-darwin-arm64.zip`
- `violet-darwin-x64.zip`
- `violet-linux-arm64.tar.gz`
- `violet-linux-x64.tar.gz`
- `violet-linux-x64-baseline.tar.gz`
- `SHA256SUMS`

每个压缩包的根目录只能包含名为 `violet` 的可执行文件。暂不发布 Windows、musl、Homebrew 或 npm 包。

## 发布前提

- 发布改动通过 PR 合并到 `main`，工作区干净且本地 `main` 与 `origin/main` 一致。
- `package.json` 使用新的语义化版本，Git 标签必须为对应的 `v<version>`。
- `main` 最新提交的“发布质量门禁”全部绿色。
- 已安装 Bun 1.3 或更高版本、Git 和 GitHub CLI。
- 使用 Firefox 完成 `gh auth login --web`，且 `gh auth status` 对目标仓库有效。

## 本地技术门禁

```bash
bun install --frozen-lockfile
bun run release:check
```

`release:check` 必须通过生产依赖审计、敏感信息扫描、核心离线测试、TypeScript 增量基线、补丁格式、源码 CLI 帮助与版本、当前平台 standalone 构建及其 Smoke Test。

完整 `tsc` 仍有继承诊断；增量门禁通过只说明诊断没有增加，不代表完整类型检查通过。预览版 Release Notes 必须如实披露这一点。

敏感信息扫描覆盖所有受 Git 管理和未忽略的待纳入文件，拒绝本地私有目录、环境变量文件、凭据文件、私钥、常见 Token、疑似硬编码凭据和维护者本机绝对路径。推送前仍需人工复核暂存差异及单提交历史。

## 创建标签

```bash
./scripts/publish-github-release.sh
```

脚本会重新验证认证、分支、远端同步状态、标签和全部本地门禁，然后创建带注释标签并只推送该标签。脚本本身不直接创建 Release。

标签触发 `.github/workflows/release.yml`：

1. 在 `ubuntu-24.04` 验证标签、版本和发布门禁。
2. 在 `macos-15`、`macos-15-intel`、`ubuntu-24.04-arm` 和 `ubuntu-24.04` 原生构建五个资产。
3. 每个 runner 执行发布二进制的 `--version` 和 `--help`，再上传 Actions Artifact。
4. 汇总 job 检查五个压缩包完整性，生成并复核 `SHA256SUMS`。
5. 创建 Draft Release，上传全部资产成功后才将其公开为 Pre-release。

任一构建、Smoke Test、哈希或上传步骤失败时，不得公开 Release。macOS 构建只执行无证书的 ad-hoc 重签以修复 Bun 编译产物布局，不构成 Developer ID 签名或 Apple 公证，也不会绕过 Gatekeeper。

## 发布后验收

在全新 macOS 和 Ubuntu 环境运行：

```bash
curl -fsSL https://raw.githubusercontent.com/Viviana-Luna/violetcode/main/install.sh |
  bash -s -- --channel preview
violet --version
violet --help
violet update --check --channel preview
```

验收必须确认不依赖 Bun 或 Git、版本与资产哈希一致、配置目录为 `~/.violet`，且当前版本被报告为最新。跨真实版本的在线替换留到下一个预览版本验证。

macOS 额外使用 Firefox 下载资产，确认系统阻止提示及“系统设置 → 隐私与安全性 → 仍要打开”的人工放行流程。构建与安装流程不得自动删除 `com.apple.quarantine`。
