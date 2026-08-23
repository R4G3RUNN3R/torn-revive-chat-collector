#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: sh deploy/restore.sh /srv/voidsmith/reviverelay/backups/reviverelay-YYYYmmdd-HHMMSS.sql.gz" >&2
  exit 64
fi

BACKUP_PATH=$1
PROJECT_DIR=${REVIVERELAY_PROJECT_DIR:-/srv/voidsmith/reviverelay}
APP_DIR=${REVIVERELAY_APP_DIR:-$PROJECT_DIR/app}
ENV_FILE=${REVIVERELAY_ENV_FILE:-$PROJECT_DIR/config/.env}
COMPOSE_FILE=${REVIVERELAY_COMPOSE_FILE:-$APP_DIR/deploy/docker-compose.yml}

if [ ! -r "$BACKUP_PATH" ]; then
  echo "ReviveRelay backup is not readable: $BACKUP_PATH" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ReviveRelay compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "ReviveRelay environment file not found: $ENV_FILE" >&2
  exit 1
fi

case "$BACKUP_PATH" in
  *.sql.gz) ;;
  *)
    echo "ReviveRelay restore expects a .sql.gz backup" >&2
    exit 1
    ;;
esac

gunzip -c "$BACKUP_PATH" \
  | docker compose \
      --env-file "$ENV_FILE" \
      -f "$COMPOSE_FILE" \
      exec -T reviverelay-db \
      sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
