import { z } from 'zod';

export type Environment = Record<string, string | undefined>;
const loopback = (host: string) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(host);
const nonempty = z.string().trim().min(1);
export const encryptionKey = z
  .string()
  .refine(
    (value) =>
      /^[A-Za-z0-9+/]{43}=$/.test(value) &&
      Buffer.from(value, 'base64').length === 32 &&
      Buffer.from(value, 'base64').toString('base64') === value,
  );
export const authSecret = z
  .string()
  .min(32)
  .refine(
    (value) =>
      new Set(value).size >= 12 &&
      !/^(test|example|changeme|replace)/i.test(value),
  );
export const databaseUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      !!url.hostname &&
      url.pathname.length > 1 &&
      !url.hash
    );
  } catch {
    return false;
  }
});
export function originSchema(production: boolean) {
  return z.string().refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.origin === value &&
        !url.username &&
        !url.password &&
        (url.protocol === 'https:' ||
          (!production && url.protocol === 'http:' && loopback(url.hostname)))
      );
    } catch {
      return false;
    }
  });
}
export function aiUrlSchema(production: boolean) {
  return z.string().refine((value) => {
    try {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.protocol === 'https:' ||
          (!production && url.protocol === 'http:' && loopback(url.hostname)))
      );
    } catch {
      return false;
    }
  });
}
export class ConfigurationError extends Error {
  constructor(public readonly fields: string[]) {
    super(`Invalid configuration: ${fields.join(', ')}`);
  }
}
export function productionMode(env: Environment) {
  if (env.LOOPEND_DEPLOYMENT === 'local') {
    // Local production-build smoke tests cannot point at a remote app or database.
    try {
      if (
        !loopback(new URL(env.APP_URL ?? '').hostname) ||
        !loopback(new URL(env.DATABASE_URL ?? '').hostname)
      )
        throw new Error();
    } catch {
      throw new ConfigurationError(['LOOPEND_DEPLOYMENT']);
    }
    return false;
  }
  if (env.LOOPEND_DEPLOYMENT && env.LOOPEND_DEPLOYMENT !== 'production')
    throw new ConfigurationError(['LOOPEND_DEPLOYMENT']);
  return (
    env.LOOPEND_DEPLOYMENT === 'production' || env.NODE_ENV === 'production'
  );
}
export function integrationSchemas(production: boolean) {
  return {
    gmail: z.object({
      APP_URL: originSchema(production),
      GOOGLE_CLIENT_ID: nonempty,
      GOOGLE_CLIENT_SECRET: nonempty,
      SOURCE_TOKEN_ENCRYPTION_KEY: encryptionKey,
    }),
    ai: z.object({
      LOOP_SCAN_AI_API_KEY: nonempty,
      LOOP_SCAN_AI_BASE_URL: aiUrlSchema(production),
      LOOP_SCAN_AI_MODEL: nonempty,
    }),
  };
}
type WorkerConfiguration = {
  DATABASE_URL: string;
  APP_URL: string;
  LOOPEND_WORKER_ONCE?: '0' | '1';
  production: boolean;
  integrations: ReturnType<typeof readIntegrations>;
};
type WebConfiguration = WorkerConfiguration & { BETTER_AUTH_SECRET: string };
export function readConfig(role: 'web', env?: Environment): WebConfiguration;
export function readConfig(
  role: 'worker',
  env?: Environment,
): WorkerConfiguration;
export function readConfig(
  role: 'web' | 'worker',
  env?: Environment,
): WorkerConfiguration | WebConfiguration;
export function readConfig(
  role: 'web' | 'worker',
  env: Environment = process.env,
) {
  const production = productionMode(env);
  const integrations = integrationSchemas(production);
  const base = z.object({
    DATABASE_URL: databaseUrl,
    APP_URL: originSchema(production),
    LOOPEND_WORKER_ONCE: z.enum(['0', '1']).optional(),
  });
  const processSchema =
    role === 'web' ? base.extend({ BETTER_AUTH_SECRET: authSecret }) : base;
  const schema =
    production || role === 'worker'
      ? processSchema
          .extend(integrations.gmail.shape)
          .extend(integrations.ai.shape)
      : processSchema;
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new ConfigurationError([
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  return {
    ...parsed.data,
    production,
    integrations: readIntegrations(env, production),
  };
}
export function readIntegrations(
  env: Environment = process.env,
  production = productionMode(env),
) {
  const schemas = integrationSchemas(production);
  const gmail = schemas.gmail.safeParse(env);
  const ai = schemas.ai.safeParse(env);
  return {
    gmail: gmail.success ? gmail.data : null,
    ai: ai.success ? ai.data : null,
  };
}
