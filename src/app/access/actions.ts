'use server';
import { redirect } from 'next/navigation';
import { authenticate } from '@/server/auth';
export async function enterWorkspace(
  _state: { error?: string },
  form: FormData,
): Promise<{ error?: string }> {
  if (!(await authenticate(String(form.get('password') ?? ''))))
    return { error: 'That password didn’t match. Please try again.' };
  redirect('/app');
}
