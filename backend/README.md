# LoL Wrapped

A League of Legends year-in-review (Wrapped) application backend.

## Tech Stack

- **Rails 7** + Ruby 3.2
- **PostgreSQL** - Database
- **Redis** - Caching & Action Cable
- **Sidekiq** - Background jobs

## Prerequisites

- Docker & Docker Compose (for Postgres + Redis)
- Ruby 3.2+ (via rbenv, rvm, or asdf)

## Setup

All commands below assume you're in the `backend/` directory:

```bash
cd backend
```

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

**Option A: Use Foreman (runs web + Sidekiq together)**

```bash
gem install foreman
foreman start -f Procfile.dev
```

**Option B: Run in separate terminals**

```bash
# Terminal 1 - Rails server
rails server

# Terminal 2 - Sidekiq
bundle exec sidekiq
```

## URLs

- **App**: http://localhost:3000
- **Sidekiq dashboard**: http://localhost:3000/sidekiq

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection |
| `PGHOST` | `localhost` | Postgres host |
| `PGPORT` | `5432` | Postgres port |
