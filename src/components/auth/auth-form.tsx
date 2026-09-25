'use client';
import { useState } from 'react';
import Link from 'next/link';
import { authClient } from './auth-client';

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const signup = mode === 'sign-up';
  async function submit(form: FormData) {
    setPending(true);
    setError('');
    try {
      const email = String(form.get('email') ?? '').trim();
      const password = String(form.get('password') ?? '');
      const result = signup
        ? await authClient.signUp.email({
            email,
            password,
            name: String(form.get('name') ?? '').trim(),
          })
        : await authClient.signIn.email({ email, password, rememberMe: true });
      if (result.error) {
        const code = result.error.code;
        setError(
          result.error.status === 429
            ? 'Too many attempts. Take a moment, then try again.'
            : code === 'PASSWORD_TOO_SHORT'
              ? 'Use a password with at least 12 characters.'
              : code === 'PASSWORD_TOO_LONG'
                ? 'Use a password with no more than 128 characters.'
                : code === 'INVALID_EMAIL'
                  ? 'Enter a valid email address.'
                  : code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'
                    ? 'An account already exists for that email. Try signing in.'
                    : signup
                      ? 'We couldn’t create an account with those details. Try signing in, or check your details.'
                      : 'Those details didn’t match. Check your email and password, then try again.',
        );
        return;
      }
      // A full navigation discards any prior user's client-side route cache.
      window.location.replace('/app');
    } catch {
      setError('We couldn’t reach your account. Please try again.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(new FormData(event.currentTarget));
      }}
      className="auth-form"
    >
      {signup && (
        <label>
          Your name
          <input name="name" autoComplete="name" required maxLength={100} />
        </label>
      )}
      <label>
        Email address
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete={signup ? 'new-password' : 'current-password'}
          required
          minLength={signup ? 12 : 1}
          maxLength={128}
          aria-describedby={signup ? 'password-hint' : undefined}
        />
      </label>
      {signup && (
        <p id="password-hint" className="field-hint">
          At least 12 characters. A few memorable words work well.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button" disabled={pending}>
        {pending
          ? 'One moment…'
          : signup
            ? 'Create your account'
            : 'Enter your space'}
        <span aria-hidden="true">↗</span>
      </button>
      <p className="auth-switch">
        {signup ? 'Already have an account?' : 'New to loopend?'}{' '}
        <Link className="text-link" href={signup ? '/sign-in' : '/sign-up'}>
          {signup ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </form>
  );
}
