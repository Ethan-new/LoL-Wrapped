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
- **ALLOWED_HOSTS** – (recommended) Comma-separated hosts to prevent DNS rebinding. Use your domain(s) or server IP, e.g. `lol-wrapped.example.com` or `123.45.67.89`
- **SIDEKIQ_USER** and **SIDEKIQ_PASSWORD** – (optional) HTTP Basic Auth for `/sidekiq`. If set, only users with these credentials can access the Sidekiq dashboard.

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
docker compose -f docker-compose.prod.yml --env-file .env build web sidekiq_ingest sidekiq_compute
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

## Auto-deploy from main

The CI workflow deploys automatically when you push to `main`, but only if Brakeman, RuboCop, and importmap audit pass.

### Step 1: Create an SSH key for GitHub Actions

On your **local machine** (Mac/Linux), open a terminal and run:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/deploy_key -N ""
```

- `-N ""` means no passphrase (required for unattended CI)
- This creates `~/.ssh/deploy_key` (private) and `~/.ssh/deploy_key.pub` (public)

### Step 2: Add the public key to your droplet

**2a. Copy the public key** (run on your local machine):

```bash
cat ~/.ssh/deploy_key.pub
```

Copy the entire line that starts with `ssh-ed25519` and ends with `github-actions-deploy`.

**2b. SSH into your droplet** (as root or your deploy user):

```bash
ssh deploy@YOUR_DROPLET_IP
```

**2c. Add the key to authorized_keys:**

```bash
mkdir -p ~/.ssh
echo "PASTE_THE_ENTIRE_PUBLIC_KEY_LINE_HERE" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

Replace `PASTE_THE_ENTIRE_PUBLIC_KEY_LINE_HERE` with the output from step 2a (keep the quotes).

**2d. Verify SSH works** (from your local machine):

```bash
ssh -i ~/.ssh/deploy_key deploy@YOUR_DROPLET_IP "echo 'SSH works'"
```

You should see `SSH works` with no password prompt.

### Step 3: Add GitHub repository secrets

**3a. Go to your repo on GitHub** → **Settings** → **Secrets and variables** → **Actions**

**3b. Click "New repository secret"** and add these three secrets:

| Name | How to get the value |
|------|------------------------|
| `DEPLOY_HOST` | Your droplet’s IPv4 address (e.g. `104.131.56.128`). Find it in the DigitalOcean dashboard. |
| `DEPLOY_USER` | The SSH user you use to log in. If you created a `deploy` user, use `deploy`. |
| `DEPLOY_SSH_KEY` | Run `cat ~/.ssh/deploy_key` on your local machine. Copy the **entire** output, including the `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----` lines. Paste as the secret value. |

⚠️ **Important:** The private key must be complete. Do not add or remove any line breaks.

### Step 4: Ensure the repo exists on the server

SSH into the droplet and run:

```bash
cd ~
ls -la LoL-Wrapped
```

- If the directory does not exist, clone the repo:

  ```bash
  git clone https://github.com/YOUR_USERNAME/LoL-Wrapped.git
  cd LoL-Wrapped
  ```

- If you cloned as root, fix ownership so the `deploy` user can pull:

  ```bash
  sudo chown -R deploy:deploy /home/deploy/LoL-Wrapped
  ```

- For a **private repo**, add the deploy public key as a deploy key: Repo → Settings → Deploy keys → Add deploy key. Paste `~/.ssh/deploy_key.pub` and enable "Allow write access" if you use SSH clone URLs.

### Step 5: Verify auto-deploy

1. Make a small change (e.g. add a comment to the README)
2. Push to `main`: `git push origin main`
3. Go to GitHub → **Actions** tab
4. You should see a workflow run. The deploy job runs after CI passes.
5. Check the deploy step logs for errors. A successful deploy ends with the `up -d` command completing.

### Deploy troubleshooting

**"Permission denied (publickey)"**  
- Confirm the public key was added correctly to `~/.ssh/authorized_keys` on the server  
- Confirm `DEPLOY_SSH_KEY` contains the full private key including header/footer lines  
- Confirm `DEPLOY_USER` matches the user that owns `~/LoL-Wrapped`

**"fatal: not a git repository"**  
- The server directory must be a git clone. Run `git clone ...` in the deploy user’s home if needed.

**Build fails during deploy**  
- SSH in and run the deploy commands manually to see the full error  
- Typical causes: missing `.env` on the server, or out-of-memory during `docker build`

---

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
docker compose -f docker-compose.prod.yml logs sidekiq_ingest sidekiq_compute
docker compose -f docker-compose.prod.yml logs postgres
```

**Rogue Sidekiq process taking jobs**

If an old Sidekiq process appears in the dashboard and is taking incoming jobs, stop it so only the intended workers (tagged "ingest" and "compute") handle work.

1. **From the Sidekiq Web UI** – Go to Busy → Processes. Find the rogue process (e.g. no tag, or "rails" instead of "ingest"/"compute") and click **Quiet Stop**. That tells it to stop accepting new jobs and shut down.

2. **From the server** – SSH in and force-recreate the Sidekiq containers so only the intended ones run:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --force-recreate sidekiq_ingest sidekiq_compute
   ```
   This stops the old containers (SIGTERM, 60s grace) and starts fresh ones. Old process entries in Redis expire within ~30 seconds.

3. **If the rogue process is not a container** – e.g. you ran `bundle exec sidekiq` manually, find and kill it:
   ```bash
   ps aux | grep sidekiq
   kill -TERM <pid>
   ```
