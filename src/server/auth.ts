import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from './db';
import { createAuth } from './auth/config';
import { LEGACY_OWNER_ID } from '../domain/ownership';
import { readConfig } from './config';
import { safeRead } from './errors';

let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  const config = readConfig('web');
  return (instance ??= createAuth(getDb(), {
    secret: config.BETTER_AUTH_SECRET,
    origin: config.APP_URL,
    secure: config.production || process.env.NODE_ENV === 'production',
  }));
}
export async function currentSession() {
  const requestHeaders = await headers();
  const session = await safeRead(() =>
    getAuth().api.getSession({ headers: requestHeaders }),
  );
  return session?.user.id === LEGACY_OWNER_ID ? null : session;
}
export async function requireWorkspace() {
  const session = await currentSession();
  if (!session) redirect('/sign-in');
  return session;
}
