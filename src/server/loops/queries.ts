import 'server-only';
import { requireWorkspace } from '../auth';
import { getDb } from '../db';
import { loopService } from './service';

// Authenticate at the data boundary as well as the layout. RSC segments can render independently.
export async function workspaceQueries() {
  await requireWorkspace();
  return loopService(getDb());
}
