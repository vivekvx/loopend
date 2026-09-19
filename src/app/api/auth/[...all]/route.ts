import { getAuth } from '@/server/auth';

// Better Auth owns CSRF, request validation, cookies, hashing, and persistent rate limiting.
async function handle(request: Request) {
  try {
    return await getAuth().handler(request);
  } catch {
    return Response.json(
      { message: 'Authentication is temporarily unavailable.' },
      { status: 503 },
    );
  }
}
export const GET = handle;
export const POST = handle;
