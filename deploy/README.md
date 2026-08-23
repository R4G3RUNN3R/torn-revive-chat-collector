# ReviveRelay deployment

ReviveRelay is deployed on the new Voidsmith VPS under `/srv/voidsmith/reviverelay` and uses its own PostgreSQL service, credentials, storage, backups, logs, and private Docker network.

## Create the project directories

```bash
sudo mkdir -p /srv/voidsmith/reviverelay/{app,config,data/postgres,backups,logs}
sudo chown -R "$USER":"$USER" /srv/voidsmith/reviverelay
chmod 700 /srv/voidsmith/reviverelay/config
```

Copy `deploy/.env.example` to `/srv/voidsmith/reviverelay/config/.env`, replace every dummy secret, then protect it:

```bash
chmod 600 /srv/voidsmith/reviverelay/config/.env
```

## Isolation rules

The `reviverelay-db` service is the only PostgreSQL instance ReviveRelay may use. Its port is not published to the host or public internet. `reviverelay-api` and `reviverelay-worker` reach it only through the private `reviverelay_internal` Docker network.

ReviveRelay must never receive database credentials, service names, or network membership belonging to DungeonMasterOS, Nexis, or any other Voidsmith product. The only intentional shared resource is the VPS host itself.

The API is published only to `127.0.0.1:3100` by default so the host reverse proxy can provide HTTPS without exposing the application container directly.

## Validate before starting

```bash
docker compose --env-file /srv/voidsmith/reviverelay/config/.env -f deploy/docker-compose.yml config
```

Confirm the database has no host `ports:` mapping:

```bash
docker compose --env-file /srv/voidsmith/reviverelay/config/.env -f deploy/docker-compose.yml config | sed -n '/reviverelay-db:/,/reviverelay-api:/p'
```

Confirm no unrelated database or network names are present:

```bash
grep -Ei 'dungeonmaster|nexis' deploy/docker-compose.yml && exit 1 || true
```

## Backups

ReviveRelay backups belong only under `/srv/voidsmith/reviverelay/backups`. A restore procedure must target only `reviverelay-db` and `/srv/voidsmith/reviverelay/data/postgres`. Do not reuse backup commands, credentials, or volumes from another Voidsmith product.
