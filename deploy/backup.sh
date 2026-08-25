#!/bin/sh
set -eu

umask 077

PROJECT_DIR=${REVIVERELAY_PROJECT_DIR:-/srv/voidsmith/torn-platform/reviverelay}
APP_DIR=${REVIVERELAY_APP_DIR:-$PROJECT_DIR/app}
BACKUP_DIR=${REVIVERELAY_BACKUP_DIR:-$PROJECT_DIR/backups/postgres}
ENV_FILE=${REVIVERELAY_ENV_FILE:-/srv/voidsmith/shared/secrets/reviverelay/runtime.env}
COMPOSE_FILE=${REVIVERELAY_COMPOSE_FILE:-$APP_DIR/deploy/docker-compose.yml}
COMPOSE_PROJECT=${REVIVERELAY_COMPOSE_PROJECT:-reviverelay}

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ReviveRelay compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "ReviveRelay environment file not found: $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
OUTPUT="$BACKUP_DIR/reviverelay-$TIMESTAMP.sql.gz"
TMP_OUTPUT="$OUTPUT.tmp"

cleanup() {
  rm -f "$TMP_OUTPUT"
}
trap cleanup EXIT HUP INT TERM

docker compose \
  -p "$COMPOSE_PROJECT" \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  exec -T reviverelay-db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | gzip -c > "$TMP_OUTPUT"

mv "$TMP_OUTPUT" "$OUTPUT"
trap - EXIT HUP INT TERM

printf '%s\n' "$OUTPUT"
