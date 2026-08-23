#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  printf 'Usage: %s /path/to/reviverelay-backup.sql.gz\n' "$0" >&2
  exit 64
fi

BACKUP=$1
if [ ! -f "$BACKUP" ]; then
  printf 'Backup file not found: %s\n' "$BACKUP" >&2
  exit 66
fi

case "$BACKUP" in
  *.sql.gz) ;;
  *)
    printf 'Backup must be a .sql.gz file: %s\n' "$BACKUP" >&2
    exit 65
    ;;
esac

ROOT=${REVIVERELAY_ROOT:-/srv/voidsmith/reviverelay}
COMPOSE_FILE=${REVIVERELAY_COMPOSE_FILE:-$ROOT/app/deploy/docker-compose.yml}
ENV_FILE=${REVIVERELAY_ENV_FILE:-$ROOT/config/.env}

gunzip -c "$BACKUP" \
  | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T reviverelay-db \
      sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
