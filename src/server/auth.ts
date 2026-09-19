import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { getDb } from './db';
import { accessLimits } from './db/schema';

const cookieName = 'loopend_session';
function config() {
  const password = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (
    (process.env.NODE_ENV === 'production' || password) &&
    (!password || password.length < 12 || !secret || secret.length < 32)
  )
    throw new Error(
      'Set APP_PASSWORD (12+ characters) and SESSION_SECRET (32+ characters) before running production.',
    );
  return { password, secret };
}
function sign(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('hex');
}
function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function requireWorkspace() {
  const { password, secret } = config();
  if (!password) return;
  const token = (await cookies()).get(cookieName)?.value ?? '';
  const [expires, signature] = token.split('.');
  if (
    !secret ||
    !expires ||
    !signature ||
    Number(expires) < Date.now() ||
    !equal(signature, sign(`${expires}:${password}`, secret))
  )
    redirect('/access');
}
export async function authenticate(passwordAttempt: string) {
  const { password, secret } = config();
  if (password && secret) {
    // One shared personal workspace: a database-backed global limit works across instances.
    const [limit] = await getDb()
      .insert(accessLimits)
      .values({
        key: 'workspace',
        attempts: 1,
        resetAt: new Date(Date.now() + 60_000),
      })
      .onConflictDoUpdate({
        target: accessLimits.key,
        set: {
          attempts: sql`CASE WHEN ${accessLimits.resetAt} < now() THEN 1 ELSE ${accessLimits.attempts} + 1 END`,
          resetAt: sql`CASE WHEN ${accessLimits.resetAt} < now() THEN now() + interval '1 minute' ELSE ${accessLimits.resetAt} END`,
        },
      })
      .returning();
    if (limit.attempts > 15) return false;
  }
  if (
    !password ||
    !secret ||
    !equal(sign(passwordAttempt, secret), sign(password, secret))
  )
    return false;
  const expires = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
  (await cookies()).set(
    cookieName,
    `${expires}.${sign(`${expires}:${password}`, secret)}`,
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    },
  );
  return true;
}
