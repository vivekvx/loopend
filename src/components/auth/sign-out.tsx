'use client';
import { useState } from 'react';
import { authClient } from './auth-client';
export function SignOut() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function signOut() {
    setPending(true);
    setError('');
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error();
      window.location.replace('/sign-in');
    } catch {
      setError('Sign out could not finish. Please try again.');
      setPending(false);
    }
  }
  return (
    <div>
      <button
        className="button button-outline"
        disabled={pending}
        onClick={signOut}
      >
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
