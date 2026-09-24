'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { DomainError } from '../../domain/loops';
import { requireWorkspace } from '../auth';
import { getDb } from '../db';
import { loopService } from '../loops/service';
import { operationalLog } from '../logging';

export type MonitoringActionState = { error?: string; message?: string };
const identity = z.object({
  id: z.uuid(),
  version: z.coerce.number().int().positive(),
});

export async function configureMonitoring(
  _state: MonitoringActionState,
  form: FormData,
): Promise<MonitoringActionState> {
  const { user } = await requireWorkspace();
  let id = '';
  try {
    const input = identity.parse(Object.fromEntries(form));
    id = input.id;
    await loopService(getDb(), user.id).configureMonitoring(
      input.id,
      input.version,
      Object.fromEntries(form),
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues.map((issue) => issue.message).join(' ') };
    if (error instanceof DomainError) return { error: error.message };
    operationalLog({ event: 'web.failed', code: 'STORAGE' });
    return { error: 'Monitoring could not be changed. Please try again.' };
  }
  revalidatePath('/app');
  revalidatePath(`/app/loops/${id}`);
  return { message: 'Monitoring updated.' };
}
