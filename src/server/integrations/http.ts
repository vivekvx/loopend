import { ScanError } from '../../domain/scan';
export type Fetcher = typeof fetch;
// Bound responses before parsing. Never include provider response bodies in errors/logs.
export async function boundedJson(
  response: Response,
  code: 'GMAIL_API' | 'AI_API',
  limit = 1_000_000,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new ScanError(code);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new ScanError(code);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ScanError(code);
  } finally {
    reader.releaseLock();
  }
}
