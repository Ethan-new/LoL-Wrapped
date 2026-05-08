# Maintenance Mode

LoL Wrapped uses a Caddy-level maintenance page that works **even when the Rails container is rebuilding or down**. It's toggled by the presence of a single flag file — no Caddy reload, no redeploy.

## How it works

- `Caddyfile` checks for `/srv/maintenance.flag` on every request.
- If the flag exists, Caddy returns HTTP **503** with `maintenance/maintenance.html` as the body and `Retry-After: 300`.
- If not, requests proxy through to `web:3000` as normal.
- The `maintenance/` directory is mounted read-only into the Caddy container at `/srv`.

## Files

| File | Purpose |
|---|---|
| `Caddyfile` | Routing logic — checks for flag, serves error page on match |
| `maintenance/maintenance.html` | The page users see during downtime |
| `maintenance/maintenance.flag` | Presence = maintenance mode ON. Not committed. |
| `docker-compose.prod.yml` | Mounts `./maintenance` → `/srv` in the `caddy` service |

## Enabling maintenance mode

SSH into the droplet, then from the project directory:

```bash
touch maintenance/maintenance.flag
```

That's it. The next request gets the 503 page. No reload needed.

Verify:

```bash
curl -I https://wrappedlol.com
# HTTP/2 503
# retry-after: 300
```

## Disabling maintenance mode

```bash
rm maintenance/maintenance.flag
```

Traffic resumes proxying to Rails immediately.

## Automated via CI

The `deploy` job in `.github/workflows/ci.yml` toggles maintenance mode automatically on every push to `main`:

1. `touch maintenance/maintenance.flag` before building
2. Build + restart `web` / `sidekiq_*`
3. `rm maintenance/maintenance.flag` on exit (via `trap`, so it clears even if the build fails)

You don't need to do anything — pushing to `main` puts the site in maintenance, deploys, and lifts it back. The page stays up across the rebuild because **Caddy itself is never restarted**.

## Manual deploy (fallback)

If you need to deploy by hand (CI down, hotfix from the droplet, etc.):

```bash
# On the droplet, from the project dir:
trap 'rm -f maintenance/maintenance.flag' EXIT
touch maintenance/maintenance.flag

git pull
docker compose -f docker-compose.prod.yml --env-file .env build web sidekiq_ingest sidekiq_compute
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml --env-file .env exec web ./bin/rails db:migrate
```

The `trap` clears the flag automatically when the shell exits.

## Customizing the page

Edit `maintenance/maintenance.html` directly on the server (or commit and `git pull`). Changes take effect on the next request — Caddy reads the file from the mounted volume.

## Local testing

You can test the flow locally with the prod compose file:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d caddy web
touch maintenance/maintenance.flag
curl -i http://localhost/  # should see the 503 page
rm maintenance/maintenance.flag
curl -i http://localhost/  # back to the app
```

## Caveats

- **Bots / SEO**: `Retry-After` + 503 is the correct signal — Google and friends will retry rather than de-index.
- **The flag isn't committed.** It's runtime state, not config. If you want maintenance mode to survive a fresh `git clone`, add it manually after cloning.
- **Health checks**: external uptime monitors will alarm during maintenance. That's intended — pause them, or whitelist 503 as "expected" for the duration.
