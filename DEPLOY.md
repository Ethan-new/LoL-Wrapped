# Deploying LoL Wrapped

Guide for deploying to a $6 DigitalOcean droplet (1 GiB RAM, 1 vCPU) or similar VPS.

## Prerequisites

- A droplet/VPS with Ubuntu 22.04 or 24.04
- A domain name pointed at your server (optional; you can use the server IP for HTTP)
- Riot API key from https://developer.riotgames.com/
- SSH access to your server

## 1. Create the droplet

1. Create a DigitalOcean droplet:
   - **Image**: Ubuntu 24.04
   - **Size**: Basic $6/mo (1 GiB RAM, 1 vCPU)
   - Add your SSH key
   - Create

2. Note your droplet's IP address.

## 2. Initial server setup

SSH into your server:

```bash
ssh root@YOUR_SERVER_IP
```

Install Docker and Docker Compose:

```bash
apt update && apt upgrade -y
apt install -y docker.io docker-compose-plugin git
systemctl enable docker
systemctl start docker
```

Create a non-root user (recommended):

```bash
adduser deploy
usermod -aG docker deploy
su - deploy
```

## 3. Clone and configure the app

```bash
cd ~
git clone https://github.com/ethan-new/LoL-Wrapped.git
cd LoL-Wrapped
```

Create `.env` with your production secrets:

```bash
cp .env.production.example .env
nano .env
```

Fill in:

- **RAILS_MASTER_KEY** – From your `config/master.key` file (or run `bin/rails credentials:show` locally and use the key that decrypts them)
- **APP_DATABASE_PASSWORD** – A strong random password for Postgres (e.g. `openssl rand -hex 24`)
- **RIOT_API_KEY** – Your Riot developer API key

## 4. Configure Caddy (HTTPS)

If you have a domain (e.g. `lol-wrapped.example.com`):

1. Add an A record: `lol-wrapped.example.com` → `YOUR_SERVER_IP`

2. Edit the Caddyfile:
   ```bash
   nano Caddyfile
   ```
   Replace `YOUR_DOMAIN` with your domain:
   ```
   lol-wrapped.example.com {
       reverse_proxy web:3000
   }
   ```

If you **don't have a domain yet**, edit Caddyfile to:

```
:80 {
    reverse_proxy web:3000
}
```

Then access the app at `http://YOUR_SERVER_IP`.

## 5. Build and start

```bash
docker compose -f docker-compose.prod.yml --env-file .env build
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Wait ~30 seconds for the database to initialize and Rails to run migrations.

Check status:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f web
```

## 6. Verify

- **With domain**: https://your-domain.com
- **Without domain**: http://YOUR_SERVER_IP
- **Sidekiq dashboard**: https://your-domain.com/sidekiq
- **Health check**: https://your-domain.com/up

## Updating the app

```bash
cd ~/LoL-Wrapped
git pull
docker compose -f docker-compose.prod.yml --env-file .env build web sidekiq
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

## Troubleshooting

**Out of memory**

- The 1 GiB plan is tight. If you see OOM kills, consider upgrading to 2 GiB ($12).

**Migrations not running**

- The web container runs `db:prepare` on startup. If you added migrations, restart the web service:
  ```bash
  docker compose -f docker-compose.prod.yml restart web
  ```

**Check logs**

```bash
docker compose -f docker-compose.prod.yml logs web
docker compose -f docker-compose.prod.yml logs sidekiq
docker compose -f docker-compose.prod.yml logs postgres
```
