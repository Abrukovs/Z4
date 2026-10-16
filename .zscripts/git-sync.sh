#!/usr/bin/env bash
#
# git-sync.sh — автосохранение проекта в GitHub (репозиторий Abrukovs/Z4).
#
# Режимы:
#   bash .zscripts/git-sync.sh "сообщение"       # авто: коммит; пуш не чаще РАЗА В ДЕНЬ
#   bash .zscripts/git-sync.sh push "сообщение"  # ручной: коммит + пуш НЕМЕДЛЕННО
#                                                # (кнопка в «Статистике», прямой запрос)
#
# Логика авто-режима (по просьбе владельца от 15.10.2026):
#   - изменения КОММИТЯТСЯ локально при каждом вызове (защита от сбросов окружения);
#   - но ОТПРАВЛЯЮТСЯ в GitHub максимум один раз в календарный день
#     (дата последнего успешного пуша хранится в .zscripts/.git-push-stamp);
#   - «push» в первом аргументе обходит троттлинг.
#
# Токен доступа к GitHub НЕ хранится в этом файле — он вшит в URL remote'а
# (.git/config, локальный файл, в репозиторий не попадает).

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

STAMP_FILE="$PROJECT_DIR/.zscripts/.git-push-stamp"
TODAY="$(date '+%Y-%m-%d')"
FORCE=0

if [ "${1:-}" = "push" ] || [ "${1:-}" = "--push" ]; then
  FORCE=1
  shift || true
fi

MESSAGE="${1:-}"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
REMOTE="$(git remote get-url origin 2>/dev/null || echo "")"

if [ -z "$REMOTE" ]; then
  echo "[git-sync] ОШИБКА: remote origin не настроен."
  exit 1
fi

# Нет изменений — не создаём пустых коммитов (но пушить незапушенное всё равно можно)
CHANGED=0
if [ -n "$(git status --porcelain)" ]; then
  CHANGED=1
  if [ -z "$MESSAGE" ]; then
    MESSAGE="auto: изменения от $(date '+%Y-%m-%d %H:%M:%S %Z')"
  fi
  echo "[git-sync] Коммит: $MESSAGE"
  git add -A
  if ! git commit -m "$MESSAGE"; then
    echo "[git-sync] ОШИБКА: не удалось закоммитить."
    exit 1
  fi
fi

# Сколько коммитов ждут отправки
UNPUSHED="$(git rev-list --count "origin/${BRANCH}..${BRANCH}" 2>/dev/null || echo 0)"

if [ "$UNPUSHED" -eq 0 ]; then
  echo "[git-sync] Изменений нет — пуш не требуется."
  exit 0
fi

# Решение: пушить ли сейчас
if [ "$FORCE" -ne 1 ]; then
  LAST_PUSH_DAY="$(cat "$STAMP_FILE" 2>/dev/null || echo '')"
  if [ "$LAST_PUSH_DAY" = "$TODAY" ]; then
    echo "[git-sync] Локально закоммичено (ожидают пуша: $UNPUSHED). Авто-пуш уже был сегодня — следующий не раньше завтра (владелец просил раз в день). Ручной пуш: git-sync.sh push \"msg\" или кнопка в «Статистике»."
    exit 0
  fi
fi

if git push origin "$BRANCH" 2>&1; then
  echo "$TODAY" > "$STAMP_FILE"
  echo "[git-sync] Отправлено в GitHub: $UNPUSHED коммит(ов) (ветка $BRANCH)."
else
  echo "[git-sync] ОШИБКА: push не удался (сеть? токен?). Коммиты ($UNPUSHED) сохранены локально, будут отправлены позже."
  exit 1
fi
