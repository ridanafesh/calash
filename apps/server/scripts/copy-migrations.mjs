#!/usr/bin/env node
/**
 * Copy SQL migration files into dist after `tsc` runs.
 *
 * Why: TypeScript only emits .ts → .js. The migration runner reads
 * raw .sql files from a `migrations/` directory next to itself, so
 * once compiled to dist/db/migrate.js it expects dist/db/migrations/.
 * Without this script the production migrate command fails with
 * `ENOENT: no such file or directory, scandir '.../dist/db/migrations'`,
 * which is exactly how a Render deploy ends up with no schema applied.
 *
 * Pure Node (no external deps) so it runs under whatever toolchain
 * the host happens to ship — including hosts with `npm ci --omit=dev`
 * stripped to runtime deps only.
 *
 * Idempotent: runs every build, overwrites identical files, never
 * deletes anything outside dist/db/migrations/.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ lives at apps/server/scripts/, so go one level up to reach
// apps/server/, then into src/ and dist/ from there.
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'db', 'migrations');
const DEST = path.join(ROOT, 'dist', 'db', 'migrations');

async function main() {
  // The src migrations directory is the source of truth. If it isn't
  // there something is very wrong — fail loudly so the deploy stops.
  const stat = await fs.stat(SRC).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(
      `Expected migrations source directory at ${SRC} but found nothing.`,
    );
  }

  await fs.mkdir(DEST, { recursive: true });

  const entries = (await fs.readdir(SRC)).filter((f) => f.endsWith('.sql'));
  if (entries.length === 0) {
    console.warn(`[copy-migrations] No .sql files found in ${SRC}.`);
  }

  for (const file of entries) {
    await fs.copyFile(path.join(SRC, file), path.join(DEST, file));
  }
  console.log(
    `[copy-migrations] Copied ${entries.length} migration file(s) to dist/db/migrations/`,
  );
}

main().catch((err) => {
  console.error('[copy-migrations] failed:', err);
  process.exit(1);
});
