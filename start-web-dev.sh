#!/usr/bin/env bash
#
# start-web-dev.sh — запуск веб-версии email-helper по двойному клику.
#
# По умолчанию (PROD-режим): собирает SPA (если устарела) и поднимает
# единый сервер `npm run web` (Node HTTP: статика + REST API) на
# WEB_HOST:WEB_PORT (127.0.0.1:3001). Открывает браузер на нём.
# Это надёжный путь: один процесс, корректные MIME-типы, нет конфликта
# кэшей dev/prod.
#
# С флагом --dev (DEV-режим): поднимает `npm run dev` (= web:dev:
# API на WEB_PORT + Vite на 5173 через concurrently) с HMR. Открывает
# Vite (5173). Внимание: если ранее открывали prod на том же браузере,
# может потребоваться жёсткое обновление (Ctrl+Shift+R) или очистка кэша
# из-за конфликта закэшированного prod-index.html и dev-сервера.
#
# Иконка скрипта = сам этот файл. Сделайте его исполняемым:
#   chmod +x start-web-dev.sh
# и двойной клик в файловом менеджере.
#
# Переменные окружения (читаются из .env проекта):
#   WEB_PORT   — порт сервера (по умолчанию 3000, в .env = 3001)
#   WEB_HOST   — хост (по умолчанию 127.0.0.1)
# Переопределить путь к node/npm можно переменной EMAIL_HELPER_NODE_BIN.

set -uo pipefail

MODE="prod"
if [[ "${1:-}" == "--dev" ]]; then
  MODE="dev"
fi

# ── 1. Каталог проекта (там, где лежит этот скрипт) ─────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"

cd "$PROJECT_DIR" || {
  echo "Не удалось перейти в каталог проекта: $PROJECT_DIR" >&2
  read -rp "Нажмите Enter для закрытия…"
  exit 1
}

# ── 2. Перезапуск в терминале, если запущены без tty (двойной клик) ─────
# Файловый менеджер запускает .sh без подключения к терминалу —
# открываем gnome-terminal и перезапускаем себя в нём.
if [[ ! -t 1 ]]; then
  if command -v gnome-terminal >/dev/null 2>&1; then
    exec gnome-terminal --wait -- bash "$0" "$@"
  elif command -v xterm >/dev/null 2>&1; then
    exec xterm -e bash "$0" "$@"
  fi
fi

# ── 3. Поиск node/npm (GUI не загружает .bashrc/nvm) ────────────────────
find_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return 0
  fi
  if [[ -n "${EMAIL_HELPER_NODE_BIN:-}" ]] \
     && [[ -x "$EMAIL_HELPER_NODE_BIN/node" ]] \
     && [[ -x "$EMAIL_HELPER_NODE_BIN/npm" ]]; then
    export PATH="$EMAIL_HELPER_NODE_BIN:$PATH"
    return 0
  fi
  for nvm_dir in "$HOME/.nvm" "/usr/local/nvm"; do
    if [[ -s "$nvm_dir/nvm.sh" ]]; then
      # shellcheck disable=SC1090
      source "$nvm_dir/nvm.sh" >/dev/null 2>&1 || true
      command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && return 0
      nvm use --silent default >/dev/null 2>&1 || \
        nvm use --silent node >/dev/null 2>&1 || true
      command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && return 0
    fi
  done
  local pi_node="$HOME/.local/share/pi-node/current/bin"
  if [[ -x "$pi_node/node" ]] && [[ -x "$pi_node/npm" ]]; then
    export PATH="$pi_node:$PATH"
    return 0
  fi
  return 1
}

if ! find_node; then
  echo "❌ Не найден Node.js/npm."
  echo "   Установите Node.js (https://nodejs.org) или задайте переменную"
  echo "   EMAIL_HELPER_NODE_BIN=<каталог с node и npm> и повторите."
  read -rp "Нажмите Enter для закрытия…"
  exit 1
fi

# ── 4. Чтение WEB_HOST/WEB_PORT из .env (для URL браузера) ──────────────
WEB_HOST="127.0.0.1"
WEB_PORT="3000"
if [[ -f ".env" ]]; then
  # Безопасно читаем только WEB_HOST/WEB_PORT, не загружая всё в окружение.
  while IFS='=' read -r key val; do
    key="${key%%#*}"  # обрезать комментарии
    val="${val%\"*}"; val="${val#\"}"  # обрезать кавычки
    [[ -z "$key" ]] && continue
    case "$key" in
      WEB_HOST) WEB_HOST="$val" ;;
      WEB_PORT) WEB_PORT="$val" ;;
    esac
  done < .env
fi
WEB_URL="http://${WEB_HOST}:${WEB_PORT}"
VITE_URL="http://localhost:5173"

echo "✅ Node:    $(command -v node) ($(node --version))"
echo "✅ npm:     $(command -v npm) ($(npm --version))"
echo "✅ Проект:  $PROJECT_DIR"
echo "✅ Режим:   $MODE"
if [[ "$MODE" == "prod" ]]; then
  echo "✅ URL:     $WEB_URL"
else
  echo "✅ URL:     $VITE_URL  (API на $WEB_URL)"
fi
echo

# ── 5. Установка зависимостей ───────────────────────────────────────────
if [[ ! -d "node_modules" ]]; then
  echo "📦 node_modules не найден — npm install (может занять несколько минут)…"
  npm install || {
    echo "❌ Ошибка установки зависимостей." >&2
    read -rp "Нажмите Enter для закрытия…"
    exit 1
  }
  echo
fi

# ── 6. Фоновое открытие браузера после старта сервера ───────────────────
open_browser() {
  local url="$1" port="$2" waited=0
  while (( waited < 40 )); do
    if (echo > "/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1; then
      sleep 1
      echo "🌐 Открываю браузер: $url"
      command -v xdg-open >/dev/null 2>&1 && xdg-open "$url" >/dev/null 2>&1 || true
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "⚠️  Сервер не поднялся за 40с — браузер не открыт. Смотрите лог выше."
}

# ── 7. Запуск сервера ───────────────────────────────────────────────────
cleanup() { kill "${OPENER_PID:-}" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

if [[ "$MODE" == "prod" ]]; then
  # PROD: собрать SPA, если сборки нет или устарела (новее src, чем dist).
  need_build=0
  if [[ ! -f "dist/client/index.html" ]]; then
    need_build=1
  else
    # Сборка нужна, если любой исходник новее dist/client/index.html.
    if find src/transport/web/client -type f \
         \( -name '*.tsx' -o -name '*.ts' -o -name '*.html' -o -name '*.css' \) \
         -newer dist/client/index.html -print -quit 2>/dev/null | grep -q .; then
      need_build=1
    fi
  fi
  if (( need_build )); then
    echo "🏗  Собираю SPA (vite build)…"
    npm run web:build || {
      echo "❌ Ошибка сборки фронтенда." >&2
      read -rp "Нажмите Enter для закрытия…"
      exit 1
    }
    echo
  else
    echo "✅ Сборка актуальна (dist/client/)."
    echo
  fi

  echo "🚀 Запускаю npm run web…  Остановить: Ctrl+C"
  echo "────────────────────────────────────────────────────────────────"
  open_browser "$WEB_URL" "$WEB_PORT" &
  OPENER_PID=$!
  npm run web
  STATUS=$?
else
  # DEV: API + Vite concurrently, HMR.
  echo "🚀 Запускаю npm run dev (web:dev: API + Vite)…  Остановить: Ctrl+C"
  echo "   ℹ️  Если в браузере была открыта prod-версия — сделайте жёсткое"
  echo "   обновление (Ctrl+Shift+R) или очистите кэш, чтобы избежать"
  echo "   конфликта закэшированного prod-index.html с dev-сервером."
  echo "────────────────────────────────────────────────────────────────"
  open_browser "$VITE_URL" "5173" &
  OPENER_PID=$!
  npm run dev
  STATUS=$?
fi

echo "────────────────────────────────────────────────────────────────"
echo "Сервер остановлен (код $STATUS)."
read -rp "Нажмите Enter для закрытия терминала…"
exit "$STATUS"
