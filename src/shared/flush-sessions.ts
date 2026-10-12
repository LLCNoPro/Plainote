import type { SaveSession } from './save-session.ts';
import type { Result } from './types.ts';
export async function flushSessions(sessions: Iterable<SaveSession>, stage: (session: SaveSession) => Promise<Result<void>>): Promise<boolean> {
  let ready = true;
  for (const session of sessions) {
    if (session.content !== session.savedContent) {
      const backup = await stage(session);
      if (!backup.ok) { session.status = 'error'; session.error = backup.error; ready = false; continue; }
    }
    // Equal current/saved text can still have an older write in flight (e.g. undo while saving).
    if (!await session.flush()) ready = false;
  }
  return ready;
}
