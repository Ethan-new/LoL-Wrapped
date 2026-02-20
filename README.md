# LoL Wrapped

A League of Legends year-in-review (Wrapped) application.

## Tech Stack

- **Rails 7** + Ruby 3.2
- **PostgreSQL** - Database
- **Redis** - Caching & Action Cable
- **Sidekiq** - Background jobs

## Prerequisites

- Docker & Docker Compose (for Postgres + Redis)
- Ruby 3.2+ (via rbenv, rvm, or asdf)

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

# Terminal 2 - Sidekiq
bundle exec sidekiq

# Terminal 3 (optional) - Tailwind CSS watcher
bin/rails tailwindcss:watch
```

## URLs

- **App**: http://localhost:3000
- **Sidekiq dashboard**: http://localhost:3000/sidekiq

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RIOT_API_KEY` | — | Riot API key (required for player lookup and ingestion) |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection (required for Sidekiq and rate limiting) |
| `PGHOST` | `localhost` | Postgres host |
| `PGPORT` | `5432` | Postgres port |

## Year recap ingestion (Wrapped-style)

The app can compute "most played with" teammates for a given player and calendar year.

### Run Sidekiq locally

Sidekiq must be running to process ingestion jobs:

```bash
bundle exec sidekiq
```

Or use `bin/dev` to run Rails + Sidekiq + Tailwind together.

### Trigger ingestion via curl

First, look up a player to get their ID (e.g. from the player page URL or API). Then:

```bash
# Trigger ingestion for year 2025 (returns 202 Accepted)
curl -X POST http://localhost:3000/players/1/ingest_year \
  -H "Content-Type: application/json" \
  -d '{"year": 2025}'
```

Response:

```json
{"status":"queued","player_id":1,"year":2025,"job_id":"..."}
```

### Fetch recap (after ingestion completes)

```bash
curl http://localhost:3000/players/1/recap/2025
```

Response:

```json
{
  "player_id": 1,
  "year": 2025,
  "most_played_with": [
    {"teammate_puuid": "...", "games": 42, "wins_together": 21},
    ...
  ]
}
```

Results are sorted by `games` desc, then `wins_together` desc (limit 20).
