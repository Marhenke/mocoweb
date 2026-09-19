import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;

if (!url) {
	throw new Error('DATABASE_URL is not set. Copy .env.example to .env and adjust it.');
}

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/lib/server/cms/db/schema.ts',
	out: './drizzle',
	dbCredentials: { url }
});
