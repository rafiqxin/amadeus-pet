#!/usr/bin/env bash
# 一键启动 AMA·DEUS 桌宠（Linux/VM 环境）
cd "$(dirname "$0")"

BIN="./release/linux-unpacked/amadeus-pet"
if [ ! -x "$BIN" ]; then
  echo "未找到打包产物，使用开发模式启动…"
  BIN="./node_modules/.bin/electron"
  ARGS="."
fi

exec env DISPLAY="${DISPLAY:-:0}" "$BIN" $ARGS --no-sandbox --ozone-platform=x11 "$@"
