'use client';
import { useActionState } from 'react';
import { acceptCandidate, ignoreCandidate } from '@/server/scan/actions';
export function CandidateActions({
  id,
  version,
}: {
  id: string;
  version: number;
}) {
  const [accept, track, tracking] = useActionState(acceptCandidate, {});
  const [ignore, dismiss, dismissing] = useActionState(ignoreCandidate, {});
  const pending = tracking || dismissing;
  return (
    <div>
      <div className="candidate-actions">
        <form action={track}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={version} />
          <button className="button button-small" disabled={pending}>
            {tracking ? 'Opening your Loop…' : 'Track this'}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
        <form action={dismiss}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={version} />
          <button className="ignore-button" disabled={pending}>
            {dismissing ? 'Ignoring…' : 'Ignore'}
          </button>
        </form>
        <span className="field-hint">Your call. Always.</span>
      </div>
      {(accept.error || ignore.error) && (
        <p className="form-error" role="alert">
          {accept.error || ignore.error}
        </p>
      )}
    </div>
  );
}
