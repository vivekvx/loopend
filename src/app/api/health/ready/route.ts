import { getDb } from '@/server/db';
import { checkDatabase, readiness } from '@/server/health';
export const dynamic = 'force-dynamic';
export async function GET() {
  const result = await readiness(() => checkDatabase(getDb()));
  return Response.json(result, {
    status: result.status === 'ready' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
