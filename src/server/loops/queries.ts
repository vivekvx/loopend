import 'server-only';
import { requireWorkspace } from '../auth';
import { getDb } from '../db';
import { loopService } from './service';
import { safeRead } from '../errors';

// Authenticate at the data boundary as well as the layout. RSC segments can render independently.
export async function workspaceQueries() {
  const { user } = await requireWorkspace();
  const service = loopService(getDb(), user.id);
  return {
    list: () => safeRead(() => service.list()),
    get: (id: string) =>
      safeRead(async () => {
        const record = await service.get(id);
        return record
          ? {
              ...record,
              monitoringDelayed:
                record.loop.monitoringEnabled &&
                !!record.loop.monitoringNextCheckAt &&
                record.loop.monitoringNextCheckAt.getTime() <
                  Date.now() - 600_000,
            }
          : null;
      }),
  };
}
