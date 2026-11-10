#!/usr/bin/env bash
# Restore an ExamDump Pro PostgreSQL backup.
#
# Usage:
#   ./restore.sh ./backups/examdump_20260101T020000Z.pgdump
#
# WARNING: this overwrites objects present in the archive. Always take a fresh
# backup first and rehearse against a scratch database.
set -euo pipefail

ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "usage: $0 <path-to-.pgdump>" >&2
  exit 1
fi
: "${DATABASE_URL:?DATABASE_URL is required}"
ARCHIVE_ABS="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"

RUNTIME="$(command -v podman || command -v docker || true)"
if [ -z "$RUNTIME" ]; then
  echo "error: neither podman nor docker found" >&2
  exit 1
fi

echo "Restoring $(basename "$ARCHIVE_ABS")"
"$RUNTIME" run --rm \
  -e DATABASE_URL \
  -v "$(dirname "$ARCHIVE_ABS"):/backup:ro" \
  docker.io/library/postgres:16-alpine \
  sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL" "/backup/'"$(basename "$ARCHIVE_ABS")"'"'

echo "Restore complete."
