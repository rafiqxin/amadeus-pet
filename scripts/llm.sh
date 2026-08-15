#!/usr/bin/env bash
# 本地 LLM 内核管理：启动/停止 llama.cpp 推理服务（Qwen2.5-0.5B）
#   ./scripts/llm.sh start   # 启动服务 (http://127.0.0.1:8080)
#   ./scripts/llm.sh stop    # 停止服务
#   ./scripts/llm.sh status
cd "$(dirname "$0")/.."

SERVER=llm/llama-b10435/llama-server
[ -x "$SERVER" ] || SERVER=llm/llama.cpp/build/bin/llama-server
MODEL=llm/models/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf
PORT=8090
LOG=/tmp/amadeus-llm.log

start() {
  if pgrep -f llama-server > /dev/null; then
    echo "llama-server 已在运行"
    return 0
  fi
  [ -x "$SERVER" ] || { echo "缺少 $SERVER（先构建 llama.cpp）"; return 1; }
  [ -f "$MODEL" ] || { echo "缺少 $MODEL（先下载模型）"; return 1; }
  echo "启动 llama-server (7B, 16 线程, ctx 2048)…"
  nohup "$SERVER" -m "$MODEL" --host 127.0.0.1 --port $PORT \
    -c 2048 --threads 16 --parallel 1 > "$LOG" 2>&1 &
  sleep 2
  curl -s --noproxy '*' -m 3 "http://127.0.0.1:$PORT/health" > /dev/null \
    && echo "OK: http://127.0.0.1:$PORT" || { echo "启动失败，见 $LOG"; tail -5 "$LOG"; }
}

stop() {
  pkill -f llama-server && echo "已停止" || echo "未在运行"
}

status() {
  if pgrep -f llama-server > /dev/null; then
    echo "运行中"; curl -s --noproxy '*' -m 3 "http://127.0.0.1:$PORT/health" && echo
  else
    echo "未运行"
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "用法: $0 {start|stop|status}" ;;
esac
