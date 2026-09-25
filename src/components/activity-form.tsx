'use client';
import { useActionState } from 'react';
import { addActivity, completeLoop } from '@/server/loops/actions';
export function ActivityForm({ id, version }: { id: string; version: number }) {
  const [state, action, pending] = useActionState(addActivity, {});
  return (
    <form action={action} className="activity-form">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <label htmlFor="activity">Add to the story</label>
      <textarea
        id="activity"
        name="body"
        required
        maxLength={4000}
        rows={3}
        placeholder="A reply, a follow-up, something that changed…"
      />
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
      <button className="button button-small button-outline" disabled={pending}>
        {pending ? 'Adding…' : 'Add activity'}
        <span aria-hidden="true">+</span>
      </button>
    </form>
  );
}
export function CompletionForm({
  id,
  version,
  condition,
}: {
  id: string;
  version: number;
  condition: string;
}) {
  const [state, action, pending] = useActionState(completeLoop, {});
  return (
    <section className="completion-panel">
      <span className="eyebrow">Confirm the outcome</span>
      <h2>Ready to close this Loop?</h2>
      <p>Loopend suggests. You decide.</p>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="version" value={version} />
        <label>
          Evidence note
          <textarea
            name="evidence"
            required
            minLength={10}
            maxLength={4000}
            rows={3}
            placeholder="What did you check, and what confirmed it?"
          />
        </label>
        <label className="checkbox-label">
          <input name="confirmed" type="checkbox" required />I verified that
          {` ${condition}`}
        </label>
        {state.error && (
          <p role="alert" className="form-error">
            {state.error}
          </p>
        )}
        <button className="button" disabled={pending}>
          {pending ? 'Closing…' : 'Verify & close Loop'}
          <span aria-hidden="true">✓</span>
        </button>
      </form>
    </section>
  );
}
