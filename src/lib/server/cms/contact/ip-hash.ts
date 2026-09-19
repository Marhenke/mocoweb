/**
 * The ONE function in this codebase allowed to touch a visitor's raw IP
 * address, and all it ever does with it is HMAC it into an opaque hash —
 * the raw value itself is never logged, stored, or passed anywhere else
 * (Lane B4's contact form is the first anonymous write path into the
 * system, so this is the first place that decision had to be made). Used
 * for two things, both of which only need "is this the same visitor as
 * before," never "who/where is this visitor": the in-memory rate limiter's
 * bucket key, and the `inquiries.ip_hash` column for spotting an abuse
 * pattern after the fact.
 */

import { createHmac } from 'node:crypto';
import { getIpHashKey } from '../auth/keys';

export function hashIp(ip: string): string {
	return createHmac('sha256', getIpHashKey()).update(ip).digest('hex');
}
