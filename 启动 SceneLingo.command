#!/bin/zsh
set -u

PROJECT_DIR="${0:A:h}"
DATA_DIR="$HOME/Library/Application Support/SceneLingo"
PID_FILE="$DATA_DIR/scenelingo.pid"
START_LOG="$DATA_DIR/logs/launcher.log"
PORT="${SCENELINGO_PORT:-8765}"
URL="http://127.0.0.1:$PORT/"

mkdir -p "$DATA_DIR/logs"
chmod 700 "$DATA_DIR" "$DATA_DIR/logs"

is_scenelingo_ready() {
  /usr/bin/curl --silent --fail --max-time 2 "$URL/api/v1/health" >/dev/null 2>&1
}

if is_scenelingo_ready; then
  /usr/bin/open "$URL"
  echo "SceneLingo 已在运行，已打开浏览器。"
  exit 0
fi

if /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "启动失败：端口 $PORT 已被其他程序占用，未终止该程序。"
  echo "请关闭占用端口的程序，或在终端中设置 SCENELINGO_PORT 后重试。"
  read "?Enter 退出…"
  exit 1
fi

if [[ ! -x "$PROJECT_DIR/.venv/bin/python" ]]; then
  echo "启动失败：未找到项目虚拟环 $PROJECT_DIR/.venv/bin/python"
  read "?Enter 退出…"
  exit 1
fi

cd "$PROJECT_DIR" || exit 1
unsetopt BG_NICE
nohup "$PROJECT_DIR/.venv/bin/python" -m app.main --port "$PORT" >>"$START_LOG" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"
chmod 600 "$PID_FILE"

for _ in {1..50}; do
  if is_scenelingo_ready; then
    /usr/bin/open "$URL"
    echo "SceneLingo 已启动，数据仅保存在本机。"
    echo "退出时请双击“停止 SceneLingo.command”。"
    exit 0
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

rm -f "$PID_FILE"
echo "SceneLingo 未能启动。请查看：$START_LOG"
read "?Enter 退出…"
exit 1
