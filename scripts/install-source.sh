#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${VIOLET_INSTALL_BIN_DIR:-$HOME/.local/bin}"
TARGET="$BIN_DIR/violet"

case "${1:-}" in
  ""|latest|current)
    ;;
  *)
    echo "错误：源码安装只支持当前检出的版本；请先切换 Git 标签，再运行 ./violet install。" >&2
    exit 2
    ;;
esac

if ! command -v bun >/dev/null 2>&1; then
  echo "错误：未找到 Bun。请先安装 Bun 1.3 或更高版本。" >&2
  exit 1
fi

if ! git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "错误：源码安装必须从 VioletCode 的 Git 工作区执行。" >&2
  exit 1
fi

if [[ "${VIOLET_INSTALL_SKIP_DEPENDENCIES:-0}" != "1" ]]; then
  echo "正在按锁文件安装依赖……"
  (
    cd "$ROOT_DIR"
    bun install --frozen-lockfile
  )
fi

mkdir -p "$BIN_DIR"
if [[ -e "$TARGET" && ! -L "$TARGET" ]]; then
  echo "错误：$TARGET 已存在且不是符号链接，未覆盖该文件。" >&2
  exit 1
fi

ln -sfn "$ROOT_DIR/violet" "$TARGET"
chmod +x "$ROOT_DIR/violet" "$ROOT_DIR/scripts/install-source.sh" "$ROOT_DIR/scripts/update-source.sh"

echo "VioletCode 已安装：$TARGET"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "提示：请将 $BIN_DIR 加入 PATH，然后执行 violet --version。"
else
  "$TARGET" --version
fi
