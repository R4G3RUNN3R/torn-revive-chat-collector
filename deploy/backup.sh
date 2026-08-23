#!/bin/sh
set -eu

umask 077

ROOT=${REVIVERELAY_ROOT:-/srv/voidsmith/reviverelay}
COMPOSE_FILE=${REVIVERELAY_COMPOSE_FILE:-$ROOT/app/deploy/docker-compose.yml}
ENV_FILE=${REVIVERELAY_ENV_FILE:-$ROOT/config/.env}
BACKUP_DIR=${REVIVERELAY_BACKUP_DIR:-$ROOT/backups}

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/reviverelay-$STAMP.sql.gz"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T reviverelay-db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | gzip > "$OUT"

printf '%s\n' "$OUT"
