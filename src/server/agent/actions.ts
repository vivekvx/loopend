'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { DomainError, MonitoringConflictError } from '../../domain/loops';
import { requireWorkspace } from '../auth';
import { getDb } from '../db';
import { loopService } from '../loops/service';
import { operationalLog } from '../logging';

export type MonitoringActionState = {
  error?: string;
  message?: string;
  nextCheckAt?: string | null;
  monitoringGeneration?: number;
  cadenceHours?: number;
  conflict?: boolean;
};
const identity = z.object({
  id: z.uuid(),
  monitoringGeneration: z.coerce.number().int().nonnegative(),
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
    const loop = await loopService(getDb(), user.id).configureMonitoring(
      input.id,
      input.monitoringGeneration,
      Object.fromEntries(form),
    );
    revalidatePath('/app');
    revalidatePath(`/app/loops/${id}`);
    return {
      message: loop.monitoringEnabled
        ? 'Schedule updated.'
        : 'Monitoring paused.',
      nextCheckAt: loop.monitoringNextCheckAt?.toISOString() ?? null,
      monitoringGeneration: loop.monitoringGeneration,
      cadenceHours: loop.monitoringCadenceHours,
    };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues.map((issue) => issue.message).join(' ') };
    if (error instanceof MonitoringConflictError)
      return {
        error:
          'Monitoring changed while this page was open. We refreshed the latest schedule; please review it before saving again.',
        conflict: true,
      };
    if (error instanceof DomainError) return { error: error.message };
    operationalLog({ event: 'web.failed', code: 'STORAGE' });
    return { error: 'Monitoring could not be changed. Please try again.' };
  }
}
