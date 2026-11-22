#!/bin/bash
# 构建 吃药服务 Mac 外壳：./build.sh            → 生成 build/吃药服务.app
#                         ./build.sh --install  → 再替换 /Applications/吃药服务.app
# 外壳只加载线上网页 https://newyik.github.io/medicine-service/ ，功能都在网页里。
set -euo pipefail
cd "$(dirname "$0")"
app="build/吃药服务.app"
rm -rf "$app"; mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
swiftc -O -parse-as-library -target arm64-apple-macos13.0 App.swift -o "$app/Contents/MacOS/WebWrap" -framework AppKit -framework WebKit
cp Info.plist "$app/Contents/Info.plist"
cp AppIcon.icns config.json "$app/Contents/Resources/"
codesign --force --sign - "$app"
echo "已生成：$app"
if [[ "${1:-}" == "--install" ]]; then
  pkill -x WebWrap 2>/dev/null && sleep 1 || true
  rm -rf "/Applications/吃药服务.app"
  ditto "$app" "/Applications/吃药服务.app"
  echo "已安装：/Applications/吃药服务.app"
fi
