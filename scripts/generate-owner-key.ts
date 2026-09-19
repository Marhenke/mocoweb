/**
 * Generates a cryptographically random OWNER_KEY and prints it to stdout.
 *
 * The entire trust root of the CMS OAuth engine (src/lib/server/cms/auth/)
 * is this one secret — everything else (JWT signing key, refresh-token
 * hashing key) is derived from it. It must come from a CSPRNG, never be
 * picked by a person: a human-chosen static credential becomes "moco2026";
 * 32 bytes from `crypto.randomBytes` doesn't.
 *
 * Usage:
 *   node scripts/generate-owner-key.ts
 *
 * Then set the printed value as the OWNER_KEY environment variable
 * (Railway: service Variables tab; local dev: your .env file — see
 * .env.example). Rotating it later is as simple as generating a new one and
 * replacing the value; every previously issued access and refresh token
 * stops working the moment the running process picks up the new value.
 */

import { randomBytes } from 'node:crypto';

const key = randomBytes(32).toString('base64url');

console.log(key);
