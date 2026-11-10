#!/usr/bin/env bash
# PostgreSQL backup for ExamDump Pro.
#
# Usage:
#   export DATABASE_URL="$(doppler secrets get DATABASE_URL --plain --project examdump-pro --config prd)"
#   ./backup.sh
#
# Env:
#   BACKUP_DIR (default ./backups)
#   BACKUP_RETENTION_DAYS (default 14)
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
BACKUP_DIR_ABS="$(cd "$BACKUP_DIR" && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="examdump_${STAMP}.pgdump"

RUNTIME="$(command -v podman || command -v docker || true)"
if [ -z "$RUNTIME" ]; then
  echo "error: neither podman nor docker found" >&2
  exit 1
fi

echo "Backing up database to $BACKUP_DIR_ABS/$BASE"
# Custom-format dump supports selective restore and parallel restore.
"$RUNTIME" run --rm \
  -e DATABASE_URL \
  -v "$BACKUP_DIR_ABS:/backup" \
  docker.io/library/postgres:16-alpine \
  sh -c 'pg_dump --no-owner --no-privileges --format=custom --file="/backup/'"$BASE"'" "$DATABASE_URL"'

find "$BACKUP_DIR_ABS" -name 'examdump_*.pgdump' -mtime +"$RETENTION" -delete
echo "Backup complete. Retaining $RETENTION days in $BACKUP_DIR_ABS"
