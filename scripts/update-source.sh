#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK_ONLY=0

case "${1:-}" in
  "")
    ;;
  --check)
    CHECK_ONLY=1
    ;;
  *)
    echo "错误：不支持的更新参数：$1" >&2
    echo "用法：violet update [--check]" >&2
    exit 2
    ;;
esac

if ! command -v bun >/dev/null 2>&1; then
  echo "错误：未找到 Bun。请先安装 Bun 1.3 或更高版本。" >&2
  exit 1
fi

if ! git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "错误：当前 VioletCode 不是源码 Git 安装，无法执行源码更新。" >&2
  exit 1
fi

BRANCH="$(git -C "$ROOT_DIR" symbolic-ref --quiet --short HEAD || true)"
if [[ -z "$BRANCH" ]]; then
  echo "错误：当前处于 detached HEAD。请先切换到需要跟踪的分支。" >&2
  exit 1
fi

if [[ -n "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=normal)" ]]; then
  echo "错误：工作区存在未提交修改。为避免覆盖本地工作，更新已取消。" >&2
  exit 1
fi

if ! git -C "$ROOT_DIR" remote get-url origin >/dev/null 2>&1; then
  echo "错误：未配置 origin 远程仓库，无法更新。" >&2
  exit 1
fi

if [[ "$CHECK_ONLY" == "1" ]]; then
  echo "更新前检查通过：分支 ${BRANCH}，工作区干净，origin 已配置。"
  exit 0
fi

echo "正在从 origin/${BRANCH} 获取更新……"
git -C "$ROOT_DIR" fetch --tags origin
git -C "$ROOT_DIR" pull --ff-only origin "$BRANCH"
(
  cd "$ROOT_DIR"
  bun install --frozen-lockfile
)

echo "VioletCode 更新完成。"
exec "$ROOT_DIR/violet" --version
