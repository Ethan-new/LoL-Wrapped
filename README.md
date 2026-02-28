# LoL Wrapped

A League of Legends year-in-review (Wrapped) application.

**Live**: [wrappedlol.com](https://wrappedlol.com)

## Tech Stack

- **Rails 8.1** + Ruby 3.4.5
- **PostgreSQL** - Database
- **Redis** - Caching & Action Cable
- **Sidekiq** - Background jobs

## Prerequisites

- Docker & Docker Compose (for Postgres + Redis)
- Ruby 3.4.5 (via rbenv, rvm, or asdf)

## Setup

All commands below assume you're in the project root:

### 1. Start Postgres & Redis

```bash
docker compose up -d
```

### 2. Install dependencies & create database

```bash
bundle install
rails db:create db:migrate
```

### 3. Run the app

**Option A: Use Foreman (runs web + Sidekiq + Tailwind together)**

```bash
gem install foreman
bin/dev
```

**Option B: Run in separate terminals**

```bash
# Terminal 1 - Rails server
bin/rails server

# Terminal 2 - Sidekiq ingest (downloads matches from Riot, concurrency 1)
bundle exec sidekiq -C config/sidekiq_ingest.yml

# Terminal 3 - Sidekiq compute (runs recap computation, never takes ingest jobs)
bundle exec sidekiq -C config/sidekiq_compute.yml

# Terminal 4 (optional) - Tailwind CSS watcher
bin/rails tailwindcss:watch
```

## URLs

- **App**: http://localhost:3000
- **Sidekiq dashboard**: http://localhost:3000/sidekiq

## Environment variables

### Development

Copy `.env.example` to `.env` and fill in values:

| Variable           | Default                    | Description                                                              |
| ------------------ | -------------------------- | ------------------------------------------------------------------------ |
| `RIOT_API_KEY`     | —                          | **Required.** Riot API key from [developer.riotgames.com](https://developer.riotgames.com/) |
| `REDIS_URL`        | `redis://localhost:6379/0` | Redis connection (Sidekiq, rate limiting)                                |
| `PGHOST`           | `localhost`                | Postgres host                                                            |
| `PGPORT`           | `5432`                     | Postgres port                                                            |
| `RIOT_MATCH_DELAY` | `1.09`                     | Seconds between match-detail API calls. Increase if rate limited.         |

### Production

Copy `.env.production.example` to `.env` on your server. See [DEPLOY.md](DEPLOY.md) for full deployment steps.

| Variable                 | Required | Description                                                         |
| ------------------------ | -------- | ------------------------------------------------------------------- |
| `RAILS_MASTER_KEY`       | Yes      | From `config/master.key` (or `bin/rails credentials:show`)         |
| `APP_DATABASE_PASSWORD`  | Yes      | Secure password for Postgres                                        |
| `RIOT_API_KEY`           | Yes      | Riot API key from [developer.riotgames.com](https://developer.riotgames.com/) |
| `ALLOWED_HOSTS`          | No       | Comma-separated hosts to prevent DNS rebinding (e.g. `wrappedlol.com,www.wrappedlol.com`) |
| `FORCE_SSL`              | No       | Set to `true` for HTTPS redirects when using a domain                |
| `SIDEKIQ_USER`           | No       | HTTP Basic Auth username for `/sidekiq` (set with `SIDEKIQ_PASSWORD`) |
| `SIDEKIQ_PASSWORD`       | No       | HTTP Basic Auth password for `/sidekiq`                              |

## Deployment

Production deploys to a Docker droplet with Caddy (HTTPS via Let's Encrypt), Postgres, Redis, and Sidekiq. See **[DEPLOY.md](DEPLOY.md)** for:

- Server setup (Ubuntu, Docker)
- Domain configuration (wrappedlol.com)
- Auto-deploy from GitHub Actions
