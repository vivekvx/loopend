'use client';
import { useActionState } from 'react';
import { deleteAccount } from '@/server/account/actions';

export function DeleteAccount() {
  const [state, action, pending] = useActionState(deleteAccount, {});
  return (
    <details className="disconnect-details">
      <summary>Delete your account</summary>
      <p>
        This permanently removes your Loops, history, suggestions, email
        evidence, connections, and sign-ins on every device. Monitoring stops.
        This cannot be undone.
      </p>
      <p>
        Encrypted backups expire under the service retention policy. Google
        access revocation is attempted after local data is erased.
      </p>
      <form action={action}>
        <label htmlFor="erase-confirmation">Type DELETE to confirm</label>
        <input
          id="erase-confirmation"
          name="confirmation"
          required
          pattern="DELETE"
          autoComplete="off"
        />
        <button
          className="button button-outline button-small"
          disabled={pending}
        >
          {pending ? 'Deleting account...' : 'Permanently delete account'}
        </button>
        {state.error && (
          <p role="alert" className="form-error">
            {state.error}
          </p>
        )}
      </form>
    </details>
  );
}
