'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import type { Loop } from '@/server/db/schema';
import { createLoop, updateLoop } from '@/server/loops/actions';
import { activeStatuses, statusLabels } from '@/domain/loops';
export function LoopForm({ loop }: { loop?: Loop }) {
  const [state, action, pending] = useActionState(
    loop ? updateLoop : createLoop,
    {},
  );
  return (
    <form action={action} className="loop-form">
      {loop && (
        <>
          <input type="hidden" name="id" value={loop.id} />
          <input type="hidden" name="version" value={loop.version} />
        </>
      )}
      <label>
        What hasn’t finished?
        <input
          autoFocus
          name="title"
          required
          minLength={3}
          maxLength={160}
          defaultValue={loop?.title}
          placeholder="e.g. A refund that hasn’t arrived"
        />
      </label>
      <label>
        What’s the situation?
        <textarea
          name="summary"
          maxLength={4000}
          defaultValue={loop?.summary}
          placeholder="A little context, so you don’t have to keep it in your head."
          rows={3}
        />
      </label>
      <label>
        Desired outcome
        <input
          name="desiredOutcome"
          required
          minLength={5}
          maxLength={2000}
          defaultValue={loop?.desiredOutcome}
          placeholder="e.g. The refund is back in my bank account"
        />
      </label>
      <div className="form-columns">
        <label>
          Current state
          <select name="status" defaultValue={loop?.status ?? 'OPEN'}>
            {activeStatuses.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Expected by
          <input
            name="expectedBy"
            type="date"
            defaultValue={loop?.expectedBy ?? ''}
          />
        </label>
      </div>
      <label>
        Who or what are we waiting on?
        <input
          name="waitingOn"
          maxLength={300}
          defaultValue={loop?.waitingOn}
          placeholder="A person, a company, or you"
        />
      </label>
      <label>
        Next action
        <textarea
          name="nextAction"
          maxLength={2000}
          defaultValue={loop?.nextAction}
          placeholder="What should happen next?"
          rows={2}
        />
      </label>
      <label>
        What will count as finished?
        <textarea
          name="verificationCondition"
          required
          minLength={5}
          maxLength={2000}
          defaultValue={loop?.verificationCondition}
          placeholder="e.g. I can see the credit on my bank statement"
          rows={3}
        />
        <span className="field-hint">
          An action is a step. A verified outcome closes the Loop.
        </span>
      </label>
      <p className="field-hint">
        This workspace tracks the steps you record. Automated follow-ups aren’t
        connected yet.
      </p>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="form-actions">
        <button className="button" disabled={pending}>
          {pending ? 'Saving…' : loop ? 'Save changes' : 'Open this Loop'}
          <span aria-hidden="true">↗</span>
        </button>
        <Link
          className="text-link"
          href={loop ? `/app/loops/${loop.id}` : '/app'}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
