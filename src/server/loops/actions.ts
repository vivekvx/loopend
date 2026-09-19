'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { DomainError } from '@/domain/loops';
import { requireWorkspace } from '../auth';
import { getDb } from '../db';
import { loopService } from './service';

export type ActionState = { error?: string };
const identity = z.object({
  id: z.uuid(),
  version: z.coerce.number().int().positive(),
});
function errorState(error: unknown): ActionState {
  if (error instanceof z.ZodError)
    return { error: error.issues.map((issue) => issue.message).join(' ') };
  if (error instanceof DomainError) return { error: error.message };
  console.error('Loop mutation failed');
  return { error: 'Your change could not be saved. Please try again.' };
}
export async function createLoop(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireWorkspace();
  let id: string;
  try {
    id = (await loopService(getDb()).create(Object.fromEntries(form))).id;
  } catch (error) {
    return errorState(error);
  }
  revalidatePath('/app');
  redirect(`/app/loops/${id}`);
}
export async function updateLoop(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireWorkspace();
  let id: string;
  try {
    const input = identity.parse(Object.fromEntries(form));
    id = input.id;
    await loopService(getDb()).update(
      id,
      input.version,
      Object.fromEntries(form),
    );
  } catch (error) {
    return errorState(error);
  }
  revalidatePath('/app');
  revalidatePath(`/app/loops/${id}`);
  redirect(`/app/loops/${id}`);
}
export async function addActivity(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireWorkspace();
  try {
    const { id, version } = identity.parse(Object.fromEntries(form));
    await loopService(getDb()).addActivity(id, version, form.get('body'));
    revalidatePath('/app');
    revalidatePath(`/app/loops/${id}`);
  } catch (error) {
    return errorState(error);
  }
  return {};
}
export async function completeLoop(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireWorkspace();
  try {
    const { id, version } = identity.parse(Object.fromEntries(form));
    await loopService(getDb()).complete(id, version, {
      evidence: form.get('evidence'),
      confirmed: form.get('confirmed') === 'on',
    });
    revalidatePath('/app');
    revalidatePath(`/app/loops/${id}`);
  } catch (error) {
    return errorState(error);
  }
  return {};
}
