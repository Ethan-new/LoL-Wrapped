# Contributing to LoL Wrapped

Thanks for your interest in contributing. This document explains how to get set up and submit changes.

## Sign your work

All contributions must be signed off. Use `git commit -s` to add a `Signed-off-by` line to your commits. See [DCO.md](DCO.md) for details.

## Development setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/LoL-Wrapped.git
   cd LoL-Wrapped
   ```

2. **Start Postgres and Redis**
   ```bash
   docker compose up -d
   ```

3. **Install dependencies and create the database**
   ```bash
   bundle install
   rails db:create db:migrate
   ```

4. **Copy environment variables**
   ```bash
   cp .env.example .env
   # Edit .env and add your RIOT_API_KEY (required for player lookup)
   ```

5. **Run the app**
   ```bash
   bin/dev
   ```

See [README.md](README.md) for more details.

## Submitting changes

1. **Fork the repo** and create a branch from `main`:
   ```bash
   git checkout -b my-feature
   ```

2. **Make your changes** and ensure they pass locally:
   ```bash
   bin/rubocop -f github
   bin/brakeman --no-pager
   bin/importmap audit
   bin/rails test
   ```

3. **Commit** with clear messages (use `-s` to sign your work):
   ```bash
   git add .
   git commit -s -m "Add feature: short description"
   ```

4. **Push** and open a Pull Request:
   ```bash
   git push origin my-feature
   ```

5. **Wait for CI** – All commits must be signed off, and Brakeman, RuboCop, and tests must pass before merge.

## Code style

- Follow [Omakase Ruby](https://github.com/rails/rubocop-rails-omakase) (RuboCop) conventions.
- Run `bin/rubocop -a` to auto-fix style issues where possible.
- Keep commits focused; one logical change per PR when practical.
