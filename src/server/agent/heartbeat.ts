import { AgentError } from '../../domain/agent';

export function leaseHeartbeat(
  renew: () => Promise<boolean>,
  intervalMs: number,
) {
  if (!Number.isFinite(intervalMs) || intervalMs < 10)
    throw new Error('Agent heartbeat interval is invalid.');

  const abort = new AbortController();
  let stopped = false;
  let lost = false;
  let renewal: Promise<boolean> | null = null;

  const loseLease = () => {
    lost = true;
    if (!abort.signal.aborted) abort.abort(new AgentError('STALE'));
  };
  const renewOwned = async () => {
    if (stopped || lost) return false;
    if (renewal) return renewal;
    renewal = renew()
      .catch(() => false)
      .then((owned) => {
        if (!owned) loseLease();
        return owned;
      })
      .finally(() => {
        renewal = null;
      });
    return renewal;
  };
  const timer = setInterval(() => void renewOwned(), intervalMs);
  timer.unref?.();

  return {
    signal: abort.signal,
    get lost() {
      return lost;
    },
    async assertOwned() {
      if (!(await renewOwned())) throw new AgentError('STALE');
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await renewal;
    },
  };
}
