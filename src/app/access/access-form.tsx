'use client';
import { useActionState } from 'react';
import { enterWorkspace } from './actions';
export function AccessForm() {
  const [state, action, pending] = useActionState(enterWorkspace, {});
  return (
    <form action={action} className="loop-form">
      <label>
        Workspace password
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
        />
      </label>
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
      <button className="button" disabled={pending}>
        {pending ? 'Opening…' : 'Enter your space ↗'}
      </button>
    </form>
  );
}
