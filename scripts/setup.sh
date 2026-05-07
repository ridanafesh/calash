#!/usr/bin/env bash
# scripts/setup.sh — First-time local development setup.
#
# Usage: ./scripts/setup.sh
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

info()    { echo -e "${BOLD}==>${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}!${RESET} $*"; }

# ── Node version check ────────────────────────────────────────────────────────
NODE_VERSION=$(node --version 2>/dev/null | cut -d. -f1 | tr -d 'v' || echo "0")
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "Node.js 20+ is required (found: $(node --version 2>/dev/null || echo 'none'))"
  exit 1
fi
success "Node.js $(node --version)"

# ── Install dependencies ──────────────────────────────────────────────────────
info "Installing dependencies..."
npm install
success "Dependencies installed"

# ── Environment files ─────────────────────────────────────────────────────────
if [ ! -f apps/server/.env ]; then
  info "Creating apps/server/.env from example..."
  cp apps/server/.env.example apps/server/.env
  success "Created apps/server/.env — edit it with your values"
else
  warn "apps/server/.env already exists — skipping"
fi

if [ ! -f apps/web/.env.local ]; then
  info "Creating apps/web/.env.local from example..."
  cp apps/web/.env.example apps/web/.env.local 2>/dev/null || echo "NEXT_PUBLIC_API_URL=http://localhost:4000" > apps/web/.env.local
  success "Created apps/web/.env.local"
else
  warn "apps/web/.env.local already exists — skipping"
fi

# ── Database ──────────────────────────────────────────────────────────────────
if command -v docker &>/dev/null; then
  info "Starting PostgreSQL via Docker..."
  docker compose up -d db
  echo "  Waiting for database to be ready..."
  sleep 3

  info "Running database migrations..."
  # db:migrate:dev runs the migrator straight from .ts via tsx, so a
  # fresh checkout doesn't need `npm run build` first. Production uses
  # the compiled-JS variant (db:migrate) chained from start:prod.
  npm run db:migrate:dev -w apps/server
  success "Migrations applied"

  info "Seeding database with development data..."
  npm run db:seed -w apps/server
  success "Database seeded"
else
  warn "Docker not found — start PostgreSQL manually, then run:"
  warn "  npm run db:migrate:dev -w apps/server"
  warn "  npm run db:seed -w apps/server"
fi

echo ""
echo -e "${GREEN}${BOLD}Setup complete!${RESET}"
echo ""
echo "Start the dev servers:"
echo "  npm run dev"
echo ""
echo "  Web:    http://localhost:3000"
echo "  API:    http://localhost:4000"
echo "  Health: http://localhost:4000/api/health"
