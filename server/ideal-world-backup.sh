#!/usr/bin/env bash
# 理想的世界 · 云端存档每日备份
set -euo pipefail

DIR=/www/wwwroot/ideal-world-data
BACKUP="$DIR/backup"
mkdir -p "$BACKUP"

STAMP=$(date +%Y%m%d-%H%M%S)
sqlite3 "$DIR/world.sqlite" ".backup '$BACKUP/world-$STAMP.sqlite'"
gzip -f "$BACKUP/world-$STAMP.sqlite"
find "$BACKUP" -name 'world-*.sqlite.gz' -mtime +14 -delete
