import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import type { LoopDatabase } from '../loops/service';
import * as schema from '../db/auth-schema';
import { LEGACY_OWNER_ID } from '../../domain/ownership';
import { authSecret, originSchema, ConfigurationError } from '../config';

export function createAuth(
  db: LoopDatabase,
  config: { secret: string; origin: string; secure: boolean },
) {
  if (!authSecret.safeParse(config.secret).success)
    throw new ConfigurationError(['BETTER_AUTH_SECRET']);
  if (!originSchema(false).safeParse(config.origin).success)
    throw new ConfigurationError(['APP_URL']);
  return betterAuth({
    appName: 'loopend',
    baseURL: config.origin,
    secret: config.secret,
    trustedOrigins: [config.origin],
    database: drizzleAdapter(db, { provider: 'pg', schema, transaction: true }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    account: { accountLinking: { enabled: false } },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: config.secure,
      cookiePrefix: 'loopend',
      database: { generateId: 'uuid' },
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
    },
    logger: { disabled: true },
    databaseHooks: {
      session: {
        create: {
          before: async (session) =>
            session.userId === LEGACY_OWNER_ID ? false : undefined,
        },
      },
    },
  });
}
