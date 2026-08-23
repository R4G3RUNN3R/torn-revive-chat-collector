# ReviveRelay VPS deployment

ReviveRelay is deployed as its own service group on the new Voidsmith VPS. Its PostgreSQL instance, credentials, persistent storage, network, migrations, backups and restore procedure are independent from every other Voidsmith application.

## Host layout

```text
/srv/voidsmith/reviverelay/
├── app/
├── config/
├── data/postgres/
├── backups/
└── logs/
```

Create the directories:

```bash
sudo mkdir -p /srv/voidsmith/reviverelay/{app,config,data/postgres,backups,logs}
sudo chown -R "$USER":"$USER" /srv/voidsmith/reviverelay
chmod 700 /srv/voidsmith/reviverelay/config
```

Copy `deploy/.env.example` to `/srv/voidsmith/reviverelay/config/.env`, replace every placeholder secret, and protect it:

```bash
chmod 600 /srv/voidsmith/reviverelay/config/.env
```

Do not copy credentials from DungeonMasterOS, Nexis, or another project. ReviveRelay receives only ReviveRelay credentials.

## Network isolation

`reviverelay-db` is attached only to the Docker network `reviverelay_internal`. That network is declared `internal: true`, and the database service publishes no host port.

The API and worker join both `reviverelay_internal` and `reviverelay_egress`. This lets them reach the dedicated database and external HTTPS services while the database itself has no outbound/public network path.

The API is published only on loopback (`127.0.0.1:3100` by default). The host reverse proxy is the only public entry point.

## Pre-deployment checks

Render and inspect the compose configuration:

```bash
docker compose --env-file /srv/voidsmith/reviverelay/config/.env -f deploy/docker-compose.yml config
```

Confirm PostgreSQL is not published:

```bash
docker compose --env-file /srv/voidsmith/reviverelay/config/.env -f deploy/docker-compose.yml config | grep -A20 'reviverelay-db:'
```

The database block must not contain `ports:`.

Confirm the project has no foreign database references:

```bash
grep -RniE 'dungeonmaster|nexis' deploy/docker-compose.yml /srv/voidsmith/reviverelay/config/.env && exit 1 || true
```

## Start/stop

```bash
docker compose --env-file /srv/voidsmith/reviverelay/config/.env -f deploy/docker-compose.yml up -d
docker compose --env-file /srv/voidsmith/reviverelay/config/.env -f deploy/docker-compose.yml ps
```

Stopping or restarting this compose project must affect only ReviveRelay services.

## Backups

Backups belong under `/srv/voidsmith/reviverelay/backups/` and must contain only the ReviveRelay database. A representative manual backup command is:

```bash
docker compose --env-file /srv/voidsmith/reviverelay/config/.env -f deploy/docker-compose.yml exec -T reviverelay-db \
  pg_dump -U reviverelay_app -d reviverelay \
  | gzip > "/srv/voidsmith/reviverelay/backups/reviverelay-$(date +%F-%H%M%S).sql.gz"
```

Restore tests must target a disposable ReviveRelay database/container, never another application's PostgreSQL service or volume.

## Reverse proxy

`deploy/reviverelay.nginx.conf.example` proxies HTTPS traffic to the API loopback port. Replace the example hostname/certificate paths before installing it on the VPS.
