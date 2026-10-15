#!/usr/bin/env bash
#
# backup-db.sh — резервная копия базы данных SQLite (без git, локально).
#
# Использование:
#   bash .zscripts/backup-db.sh          # обычный бэкап
#
# Что делает:
#   1. Делает атомарный снимок db/custom.db через SQLite «VACUUM INTO»
#      (гарантированно целостный, даже если сайт прямо сейчас пишет в базу).
#   2. Складывает в backups/db-ГГГГ-ММ-ДД-ЧЧММ.db.
#   3. Оставляет последние 14 копий, более старые удаляет.
#
# Почему это важно: файл БД не хранится в GitHub (там секреты), поэтому
# единственная защита данных — локальные копии. Запускается ежедневно
# в 03:00 МСК по cron, а также перед любыми изменениями схемы Prisma.

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_FILE="$PROJECT_DIR/db/custom.db"
BACKUP_DIR="$PROJECT_DIR/backups"
KEEP=14

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_FILE" ]; then
  echo "[backup] ОШИБКА: база не найдена: $DB_FILE"
  exit 1
fi

STAMP="$(date '+%Y-%m-%d-%H%M')"
TARGET="$BACKUP_DIR/db-$STAMP.db"

cd "$PROJECT_DIR"
if bun -e "
const {Database} = require('bun:sqlite');
const db = new Database('$DB_FILE', {readonly: true});
db.exec(\"VACUUM INTO '$TARGET'\");
db.close();
console.log('done');
" >/dev/null 2>&1 && [ -f "$TARGET" ]; then
  SIZE=$(du -h "$TARGET" | cut -f1)
  echo "[backup] Готово: $TARGET ($SIZE)"
else
  # Фолбэк: простое копирование (чуть менее безопасно, но лучше, чем ничего)
  cp "$DB_FILE" "$TARGET" && echo "[backup] Готово (копированием): $TARGET" || { echo "[backup] ОШИБКА: снимок не создан"; exit 1; }
fi

# Ротация: храним последние $KEEP копий
ls -1t "$BACKUP_DIR"/db-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old" && echo "[backup] Удалена старая копия: $old"
done
