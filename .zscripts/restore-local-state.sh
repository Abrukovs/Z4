#!/usr/bin/env bash
#
# restore-local-state.sh — восстановление после ночного сброса окружения.
#
# Платформа периодически (по наблюдениям — каждую ночь) сбрасывает рабочую
# копию: gitignored-файлы удаляются (db/custom.db пересоздаётся пустым,
# настройки Telegram-бота пропадают). При этом .git и отслеживаемые файлы
# ВЫЖИВАЮТ. Поэтому жизнеспособные копии хранятся в .git/local-backup/
# (эта папка никогда не попадает в GitHub — git не пушит содержимое .git).
#
# Использование:
#   bash .zscripts/restore-local-state.sh   # запускать в начале каждого
#                                          # агентского цикла и после сбросов
#
# Что делает:
#   1. Если БД пуста/отсутствует — предупреждает (схему создаст startup,
#      данные — авто-сидинг при первом визите на сайт).
#   2. Если настройки бота в БД стёрты, а в .git/local-backup/ есть копия —
#      восстанавливает их (токен, чат, час, флаг вкл/выкл).
#   3. Печатает итог — по нему утренний агент понимает состояние.

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

STASH="$PROJECT_DIR/.git/local-backup"
SETTINGS_FILE="$STASH/bot-settings.json"

echo "[restore] Проверка состояния после возможного сброса окружения…"

if [ ! -f "$PROJECT_DIR/db/custom.db" ]; then
  echo "[restore] ВНИМАНИЕ: db/custom.db отсутствует — стартовые скрипты создадут её,"
  echo "[restore] авто-сидинг заполнит демо-данными при первом визите сайта."
fi

# Текущее состояние настроек в БД
HAS_SETTINGS=$(bun -e "
import {PrismaClient} from '@prisma/client';
const p = new PrismaClient();
const s = await p.digestSettings.findFirst();
console.log(s && s.telegramBotToken ? 'yes' : 'no');
process.exit(0);
" 2>/dev/null | tail -1)

if [ "$HAS_SETTINGS" = "yes" ]; then
  echo "[restore] Настройки Telegram-бота в БД на месте — восстановление не требуется."
  exit 0
fi

if [ ! -f "$SETTINGS_FILE" ]; then
  echo "[restore] Настройки стёрты, но и резервной копии в .git/local-backup нет."
  echo "[restore] Владельцу нужно заново ввести токен бота на сайте (раздел «Утренний разбор»)."
  exit 0
fi

echo "[restore] Настройки стёрты — восстанавливаю из .git/local-backup/bot-settings.json…"
RESTORE_RESULT=$(bun -e "
import {PrismaClient} from '@prisma/client';
import { readFileSync } from 'node:fs';
const stash = JSON.parse(readFileSync('$SETTINGS_FILE', 'utf8'));
const p = new PrismaClient();
const s = await p.digestSettings.upsert({
  where: { id: 'main' },
  update: { telegramEnabled: stash.telegramEnabled, telegramBotToken: stash.telegramBotToken, telegramChatId: stash.telegramChatId, telegramChatTitle: stash.telegramChatTitle, sendHour: stash.sendHour },
  create: { id: 'main', telegramEnabled: stash.telegramEnabled, telegramBotToken: stash.telegramBotToken, telegramChatId: stash.telegramChatId, telegramChatTitle: stash.telegramChatTitle, sendHour: stash.sendHour },
});
console.log(s.telegramEnabled ? 'ok' : 'off');
process.exit(0);
" 2>/dev/null | tail -1)

if [ "$RESTORE_RESULT" = "ok" ] || [ "$RESTORE_RESULT" = "off" ]; then
  echo "[restore] Готово: настройки бота восстановлены (enabled=$RESTORE_RESULT)."
  echo "[restore] Мини-сервис бота подхватит их в течение ~20 секунд (self-heal)."
else
  echo "[restore] ОШИБКА восстановления: $RESTORE_RESULT"
  exit 1
fi
