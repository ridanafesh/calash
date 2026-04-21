#!/usr/bin/env bash
# scripts/reset-db.sh — Drop, recreate, migrate, and seed the dev database.
#
# Usage: ./scripts/reset-db.sh
#        DATABASE_URL=postgresql://... ./scripts/reset-db.sh
#
# WARNING: destroys all data in the database.
set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:password@localhost:5432/calash}"

# Parse DB name from URL
DB_NAME=$(echo "$DB_URL" | sed 's|.*/||' | sed 's|?.*||')
DB_BASE=$(echo "$DB_URL" | sed "s|/$DB_NAME.*||")

echo "This will DROP and recreate database: $DB_NAME"
read -r -p "Are you sure? [y/N] " confirm
if [[ "$confirm" != [yY] ]]; then
  echo "Aborted."
  exit 0
fi

echo "Dropping database..."
psql "${DB_BASE}/postgres" -c "DROP DATABASE IF EXISTS ${DB_NAME};" 2>/dev/null || true

echo "Creating database..."
psql "${DB_BASE}/postgres" -c "CREATE DATABASE ${DB_NAME};"

echo "Running migrations..."
npm run db:migrate -w apps/server

echo "Seeding database..."
npm run db:seed -w apps/server

echo "Done. Database $DB_NAME is ready."
