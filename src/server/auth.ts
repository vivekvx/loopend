import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from './db';
import { createAuth } from './auth/config';
import { LEGACY_OWNER_ID } from '../domain/ownership';

let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (instance ??= createAuth(getDb(), {
    secret: process.env.BETTER_AUTH_SECRET ?? '',
    origin: process.env.APP_URL ?? '',
    secure: process.env.NODE_ENV === 'production',
  }));
}
export async function currentSession() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session?.user.id === LEGACY_OWNER_ID ? null : session;
}
export async function requireWorkspace() {
  const session = await currentSession();
  if (!session) redirect('/sign-in');
  return session;
}
