import { redirect } from 'next/navigation';
import { Brand, LoopMark } from '../brand';
import { currentSession } from '@/server/auth';
import { AuthForm } from './auth-form';

export async function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  if (await currentSession()) redirect('/app');
  const signup = mode === 'sign-up';
  return (
    <main id="main" className="auth-page">
      <Brand />
      <div className="auth-layout">
        <section>
          <div className="page-intro">
            <span className="eyebrow">Your personal space</span>
            <h1>
              {signup
                ? 'A little less on your mind.'
                : 'Leave the noise outside.'}
            </h1>
            <p>
              {signup
                ? 'Make a home for the things that haven’t finished.'
                : 'Your Loops are right where you left them.'}
            </p>
          </div>
          <AuthForm mode={mode} />
        </section>
        <aside className="auth-aside">
          <LoopMark />
          <p>
            One place for your loose ends.
            <br />
            <em>Until it’s done.</em>
          </p>
          <span>Private to you. Nothing tracked without your say.</span>
        </aside>
      </div>
    </main>
  );
}
