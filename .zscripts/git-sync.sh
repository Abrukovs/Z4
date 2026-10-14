#!/usr/bin/env bash
#
# git-sync.sh — автосохранение проекта в GitHub (репозиторий Abrukovs/Z4).
#
# Использование:
#   bash .zscripts/git-sync.sh              # автосообщение с датой/временем
#   bash .zscripts/git-sync.sh "фикс фикс"  # своё сообщение коммита
#
# Что делает:
#   1. Смотрит, есть ли изменения (git status) — если нет, тихо выходит.
#   2. Фиксирует изменения коммитом (add -A; секреты исключены через .gitignore).
#   3. Отправляет коммит в GitHub (push origin main).
#
# Токен доступа к GitHub НЕ хранится в этом файле — он вшит в URL remote'а
# (.git/config, локальный файл, в репозиторий не попадает).

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

MESSAGE="${1:-}"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
REMOTE="$(git remote get-url origin 2>/dev/null || echo "")"

if [ -z "$REMOTE" ]; then
  echo "[git-sync] ОШИБКА: remote origin не настроен."
  exit 1
fi

# Нет изменений — не создаём пустых коммитов
if [ -z "$(git status --porcelain)" ]; then
  echo "[git-sync] Изменений нет — пуш не требуется."
  exit 0
fi

if [ -z "$MESSAGE" ]; then
  MESSAGE="auto: изменения от $(date '+%Y-%m-%d %H:%M:%S %Z')"
fi

echo "[git-sync] Коммит: $MESSAGE"
git add -A
if ! git commit -m "$MESSAGE"; then
  echo "[git-sync] ОШИБКА: не удалось закоммитить."
  exit 1
fi

if git push origin "$BRANCH"; then
  echo "[git-sync] Отправлено в GitHub (ветка $BRANCH)."
else
  echo "[git-sync] ОШИБКА: push не удался (сеть? токен?). Коммит сохранён локально."
  exit 1
fi
