/**
 * Database client for the CMS engine.
 *
 * Uses the postgres.js driver (not node-postgres or a query-engine binary)
 * specifically so the production build stays a single self-contained Node
 * process — no extra native binary to ship alongside the app.
 *
 * This file lives under `src/lib/server/`, SvelteKit's server-only import
 * boundary: it can never end up in a client bundle, which is what we want
 * for a database connection string.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
	throw new Error('DATABASE_URL is not set. Copy .env.example to .env and adjust it.');
}

// A single shared connection pool for the process's lifetime.
const client = postgres(connectionString);

export const db = drizzle(client, { schema });
