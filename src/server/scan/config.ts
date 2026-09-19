import { z } from 'zod';

type Environment = Record<string, string | undefined>;
export function scanSetup(env: Environment = process.env) {
  const key = env.SOURCE_TOKEN_ENCRYPTION_KEY;
  const encrypted =
    !!key &&
    /^[A-Za-z0-9+/]{43}=$/.test(key) &&
    Buffer.from(key, 'base64').length === 32;
  let origin: string | undefined;
  try {
    const url = new URL(env.APP_URL ?? '');
    if (
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname))) &&
      url.pathname === '/' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
      origin = url.origin;
  } catch {
    /* Missing/invalid configuration is a supported product state. */
  }
  const gmailReady = !!(
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    encrypted &&
    origin
  );
  const baseUrl =
    env.LOOP_SCAN_AI_BASE_URL || 'https://ai-gateway.vercel.sh/v1';
  const validAIUrl =
    z.url().safeParse(baseUrl).success &&
    new URL(baseUrl).protocol === 'https:' &&
    !new URL(baseUrl).username &&
    !new URL(baseUrl).password;
  const aiReady = !!(env.LOOP_SCAN_AI_API_KEY && validAIUrl);
  return {
    gmailReady,
    aiReady,
    origin,
    model: env.LOOP_SCAN_AI_MODEL || 'openai/gpt-4.1-mini',
    baseUrl,
  };
}
