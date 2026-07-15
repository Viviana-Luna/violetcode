#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="Viviana-Luna/violetcode"
API_BASE="${VIOLET_GITHUB_API_BASE:-https://api.github.com/repos/$REPOSITORY}"
DOWNLOAD_BASE="${VIOLET_GITHUB_DOWNLOAD_BASE:-https://github.com/$REPOSITORY/releases/download}"
CHANNEL="preview"
VERSION=""
BIN_DIR="${VIOLET_INSTALL_BIN_DIR:-$HOME/.local/bin}"

usage() {
  cat <<'EOF'
用法：install.sh [--channel stable|preview] [--version vX.Y.Z] [--bin-dir PATH]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel)
      CHANNEL="${2:-}"
      shift 2
      ;;
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --bin-dir)
      BIN_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "错误：不支持的安装参数：$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$CHANNEL" != "stable" && "$CHANNEL" != "preview" ]]; then
  echo "错误：更新频道必须是 stable 或 preview。" >&2
  exit 2
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "错误：未找到 curl。" >&2
  exit 1
fi

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS/$ARCH" in
  Darwin/arm64) ASSET="violet-darwin-arm64.zip" ;;
  Darwin/x86_64) ASSET="violet-darwin-x64.zip" ;;
  Linux/aarch64|Linux/arm64) ASSET="violet-linux-arm64.tar.gz" ;;
  Linux/x86_64)
    if grep -qE '(^|[[:space:]])avx2([[:space:]]|$)' /proc/cpuinfo 2>/dev/null; then
      ASSET="violet-linux-x64.tar.gz"
    else
      ASSET="violet-linux-x64-baseline.tar.gz"
    fi
    ;;
  *)
    case "$OS" in
      MINGW*|MSYS*|CYGWIN*)
        echo "错误：Windows 请使用 install.ps1：powershell -ExecutionPolicy Bypass -File install.ps1 -Channel $CHANNEL" >&2
        ;;
      *)
        echo "错误：当前平台没有 VioletCode 发布包：$OS/$ARCH" >&2
        ;;
    esac
    exit 1
    ;;
esac

mkdir -p "$BIN_DIR"
TEMP_DIR="$(mktemp -d "$BIN_DIR/.violet-install.XXXXXX")"
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

api_get() {
  curl -fsSL \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    -H 'User-Agent: violet-installer' \
    "$1"
}

release_tag_from_json() {
  sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -1
}

preview_key() {
  local value="${1#v}"
  local core="${value%%-*}"
  local suffix="${value#*-preview.}"
  local major minor patch
  IFS='.' read -r major minor patch <<<"$core"
  [[ "$suffix" =~ ^[0-9]+$ ]] || return 1
  printf '%09d%09d%09d%09d' "$major" "$minor" "$patch" "$suffix"
}

if [[ -n "$VERSION" ]]; then
  TAG="$VERSION"
  [[ "$TAG" == v* ]] || TAG="v$TAG"
  api_get "$API_BASE/releases/tags/$TAG" >"$TEMP_DIR/release.json"
elif [[ "$CHANNEL" == "stable" ]]; then
  api_get "$API_BASE/releases/latest" >"$TEMP_DIR/release.json"
  TAG="$(release_tag_from_json "$TEMP_DIR/release.json")"
else
  api_get "$API_BASE/releases?per_page=30" >"$TEMP_DIR/releases.json"
  awk '
    {
      gsub(/"tag_name"[[:space:]]*:/, "\n\"tag_name\":")
      gsub(/"draft"[[:space:]]*:/, "\n\"draft\":")
      gsub(/"prerelease"[[:space:]]*:/, "\n\"prerelease\":")
      print
    }
  ' "$TEMP_DIR/releases.json" | awk '
    /^[[:space:]]*"tag_name":/ {
      line = $0
      sub(/.*"tag_name":[[:space:]]*"/, "", line)
      sub(/".*/, "", line)
      tag = line
    }
    /^[[:space:]]*"draft":[[:space:]]*false/ { draft = 0 }
    /^[[:space:]]*"draft":[[:space:]]*true/ { draft = 1 }
    /^[[:space:]]*"prerelease":[[:space:]]*true/ {
      if (!draft && tag != "") print tag
      tag = ""
      draft = 0
    }
  ' >"$TEMP_DIR/preview-tags"
  TAG=""
  BEST_KEY=""
  while IFS= read -r candidate; do
    key="$(preview_key "$candidate" 2>/dev/null || true)"
    if [[ -n "$key" && ( -z "$BEST_KEY" || "$key" > "$BEST_KEY" ) ]]; then
      TAG="$candidate"
      BEST_KEY="$key"
    fi
  done <"$TEMP_DIR/preview-tags"
  [[ -n "$TAG" ]] || { echo "错误：没有找到可用的 VioletCode 预览版本。" >&2; exit 1; }
fi

[[ -n "${TAG:-}" ]] || { echo "错误：无法解析 VioletCode Release 标签。" >&2; exit 1; }
BASE_URL="$DOWNLOAD_BASE/$TAG"
curl -fsSL --retry 3 --connect-timeout 15 -o "$TEMP_DIR/$ASSET" "$BASE_URL/$ASSET"
curl -fsSL --retry 3 --connect-timeout 15 -o "$TEMP_DIR/SHA256SUMS" "$BASE_URL/SHA256SUMS"

EXPECTED="$(awk -v asset="$ASSET" '$2 == asset || $2 == "*" asset { print $1; exit }' "$TEMP_DIR/SHA256SUMS")"
[[ "$EXPECTED" =~ ^[a-fA-F0-9]{64}$ ]] || { echo "错误：SHA256SUMS 中没有 $ASSET。" >&2; exit 1; }
if command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$TEMP_DIR/$ASSET" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TEMP_DIR/$ASSET" | awk '{print $1}')"
else
  echo "错误：系统缺少 SHA-256 校验工具。" >&2
  exit 1
fi
ACTUAL_LOWER="$(printf '%s' "$ACTUAL" | tr '[:upper:]' '[:lower:]')"
EXPECTED_LOWER="$(printf '%s' "$EXPECTED" | tr '[:upper:]' '[:lower:]')"
[[ "$ACTUAL_LOWER" == "$EXPECTED_LOWER" ]] || { echo "错误：$ASSET 的 SHA-256 校验失败。" >&2; exit 1; }

mkdir "$TEMP_DIR/extracted"
if [[ "$ASSET" == *.zip ]]; then
  command -v unzip >/dev/null 2>&1 || { echo "错误：未找到 unzip。" >&2; exit 1; }
  unzip -q "$TEMP_DIR/$ASSET" -d "$TEMP_DIR/extracted"
else
  tar -xzf "$TEMP_DIR/$ASSET" -C "$TEMP_DIR/extracted"
fi
NEW_BINARY="$TEMP_DIR/extracted/violet"
chmod 755 "$NEW_BINARY"
EXPECTED_VERSION="${TAG#v}"
OUTPUT="$($NEW_BINARY --version 2>&1)"
[[ "$OUTPUT" == "v$EXPECTED_VERSION (VioletCode)" ]] || { echo "错误：新二进制版本验证失败：$OUTPUT" >&2; exit 1; }

TARGET="$BIN_DIR/violet"
if [[ -e "$TARGET" || -L "$TARGET" ]]; then
  CURRENT_OUTPUT="$($TARGET --version 2>/dev/null || true)"
  [[ "$CURRENT_OUTPUT" == *"(VioletCode)"* ]] || { echo "错误：$TARGET 已存在且不是 VioletCode，拒绝覆盖。" >&2; exit 1; }
fi

REPLACEMENT="$BIN_DIR/.violet-new-$$"
mv "$NEW_BINARY" "$REPLACEMENT"
chmod 755 "$REPLACEMENT"
mv -f "$REPLACEMENT" "$TARGET"

echo "VioletCode $TAG 已安装：$TARGET"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "提示：请将 $BIN_DIR 加入 PATH。"
fi
if [[ "$OS" == "Darwin" ]]; then
  echo "提示：VioletCode 未使用 Apple Developer ID 签名或公证。"
  echo "如果 macOS 阻止首次运行，请前往“系统设置 → 隐私与安全性 → 仍要打开”手动放行。"
fi
