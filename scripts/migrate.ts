/**
 * Applies pending SQL migrations from ./drizzle to the database at
 * DATABASE_URL. Safe to run repeatedly: drizzle tracks which migrations have
 * already been applied (in a `drizzle`.`__drizzle_migrations` table) and
 * skips them.
 *
 * Usage: npm run db:migrate
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
	throw new Error('DATABASE_URL is not set. Copy .env.example to .env and adjust it.');
}

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

console.log('Applying migrations from ./drizzle ...');
await migrate(db, { migrationsFolder: './drizzle' });
console.log('Done.');

await sql.end();
