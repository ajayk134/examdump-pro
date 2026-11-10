#!/usr/bin/env bash
# MongoDB backup for ExamDump Pro.
#
# Usage:
#   export MONGODB_URI="$(doppler secrets get MONGODB_URI --plain --project examdump-pro --config prd)"
#   export MONGODB_DB=examdump
#   ./backup.sh
#
# Env:
#   BACKUP_DIR (default ./backups)
#   BACKUP_RETENTION_DAYS (default 14)
set -euo pipefail

: "${MONGODB_URI:?MONGODB_URI is required}"
export MONGODB_DB="${MONGODB_DB:-examdump}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
BACKUP_DIR_ABS="$(cd "$BACKUP_DIR" && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="${MONGODB_DB}_${STAMP}.archive.gz"

RUNTIME="$(command -v podman || command -v docker || true)"
if [ -z "$RUNTIME" ]; then
  echo "error: neither podman nor docker found" >&2
  exit 1
fi

echo "Backing up database '$MONGODB_DB' to $BACKUP_DIR_ABS/$BASE"
"$RUNTIME" run --rm \
  -e MONGODB_URI \
  -e MONGODB_DB \
  -v "$BACKUP_DIR_ABS:/backup" \
  mongo:7 \
  sh -c 'mongodump --uri="$MONGODB_URI" --db="$MONGODB_DB" --archive="/backup/'"$BASE"'" --gzip'

find "$BACKUP_DIR_ABS" -name "${MONGODB_DB}_*.archive.gz" -mtime +"$RETENTION" -delete
echo "Backup complete. Retaining $RETENTION days in $BACKUP_DIR_ABS"