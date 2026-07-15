#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v gh >/dev/null 2>&1; then
  echo "错误：未找到 GitHub CLI（gh）。" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "错误：GitHub CLI 认证无效。请先在 Firefox 中完成 gh auth login --web。" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "错误：工作区存在未提交修改，拒绝发布。" >&2
  exit 1
fi

BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "main" ]]; then
  echo "错误：正式 Release 只能从 main 分支创建，当前分支为 ${BRANCH:-未知}。" >&2
  exit 1
fi

git fetch --tags origin main
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "错误：本地 main 与 origin/main 不一致，拒绝创建发布标签。" >&2
  exit 1
fi

VERSION="$(bun -e "console.log((await Bun.file('package.json').json()).version)")"
TAG="v$VERSION"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "错误：标签 $TAG 已存在。请先更新 package.json 版本。" >&2
  exit 1
fi
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "错误：GitHub Release $TAG 已存在。请先更新 package.json 版本。" >&2
  exit 1
fi

bun run release:check

echo "即将创建并推送发布标签：$TAG"
git tag -a "$TAG" -m "发布 VioletCode $TAG"
git push origin "$TAG"

echo "标签已推送；GitHub Actions 将构建全部平台产物并创建 Pre-release：$TAG"
