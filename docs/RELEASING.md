# VioletCode 发布流程

## 发布前提

- 在 `main` 分支上发布。
- 工作区干净，所有目标改动已经提交。
- `package.json` 使用新的语义化版本号。
- 已安装 Bun 1.3 或更高版本、Git 和 GitHub CLI。
- `gh auth status` 对目标仓库有效。
- `main` 最新提交的 GitHub Actions“发布质量门禁”通过。

## 技术门禁

```bash
bun install --frozen-lockfile
bun run release:check
```

`release:check` 必须依次通过：

1. 生产依赖安全审计。
2. 核心离线测试。
3. TypeScript 增量基线门禁。
4. `git diff --check`。
5. 隔离配置目录的 CLI 帮助和版本检查。

当前完整 `tsc` 仍有继承诊断，必须在 Release 说明中如实披露；不得把增量门禁通过描述为完整类型检查通过。

## 创建 Release

```bash
./scripts/publish-github-release.sh
```

脚本会拒绝以下状态：

- 工作区有未提交修改。
- 当前版本对应的 `v<version>` 标签已存在。
- 任一技术门禁失败。

通过后，脚本使用当前提交创建 GitHub Release，并由 GitHub 生成源码压缩包和 Release Notes。

## 发布后验证

在一个新的临时目录执行：

```bash
git clone https://github.com/Viviana-Luna/violetcode.git
cd violetcode
./violet install
violet --version
violet --help
violet update --check
```

随后使用隔离配置目录人工验证 `/connect`、`/model`、一轮短对话和正常退出。真实 Provider 验收应限制为最短输出，并记录使用的版本、Provider、结果和进程退出状态；不得把 API Key 写入验收记录。
