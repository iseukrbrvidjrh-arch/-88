#!/bin/zsh
set -u

DATA_DIR="$HOME/Library/Application Support/SceneLingo"
PID_FILE="$DATA_DIR/scenelingo.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "SceneLingo 没有由双击启动器记录的运行进程。"
  exit 0
fi

PID="$(<"$PID_FILE")"
if [[ ! "$PID" =~ '^[0-9]+$' ]]; then
  echo "停止失败：PID 文件无效，未终止任何进程。"
  exit 1
fi

COMMAND="$(ps -p "$PID" -o command= 2>/dev/null || true)"
if [[ -z "$COMMAND" ]]; then
  rm -f "$PID_FILE"
  echo "SceneLingo 已停止，已清理过期记录。"
  exit 0
fi

if [[ "$COMMAND" != *"-m app.main"* ]]; then
  echo "停止失败：PID $PID 不是 SceneLingo 进程，未终止它。"
  exit 1
fi

kill -TERM "$PID"
for _ in {1..50}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "SceneLingo 已安全停止。"
    exit 0
  fi
  sleep 0.1
done

echo "SceneLingo 正在结束，请稍后再双击本文件确认。"
exit 1
