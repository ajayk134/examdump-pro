#!/usr/bin/env bash
# Restore an ExamDump Pro MongoDB backup.
#
# Usage:
#   ./restore.sh ./backups/examdump_20260101T020000Z.archive.gz
#
# WARNING: this drops existing collections that are present in the archive.
# Always take a fresh backup before restoring and use a scratch database first.
set -euo pipefail

ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "usage: $0 <path-to-.archive.gz>" >&2
  exit 1
fi
: "${MONGODB_URI:?MONGODB_URI is required}"
export MONGODB_DB="${MONGODB_DB:-examdump}"
ARCHIVE_ABS="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"

RUNTIME="$(command -v podman || command -v docker || true)"
if [ -z "$RUNTIME" ]; then
  echo "error: neither podman nor docker found" >&2
  exit 1
fi

echo "Restoring $(basename "$ARCHIVE_ABS") into database '$MONGODB_DB'"
"$RUNTIME" run --rm \
  -e MONGODB_URI \
  -e MONGODB_DB \
  -v "$(dirname "$ARCHIVE_ABS"):/backup:ro" \
  mongo:7 \
  sh -c 'mongorestore --uri="$MONGODB_URI" --nsInclude="${MONGODB_DB}.*" --drop --gzip --archive="/backup/'"$(basename "$ARCHIVE_ABS")"'"'

echo "Restore complete."