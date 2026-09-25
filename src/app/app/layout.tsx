import Link from 'next/link';
import { Brand } from '@/components/brand';
import { requireWorkspace } from '@/server/auth';
import { SignOut } from '@/components/auth/sign-out';
export const dynamic = 'force-dynamic';
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireWorkspace();
  return (
    <div className="workspace">
      <header className="app-header">
        <Brand href="/app" />
        <nav aria-label="Workspace">
          <Link href="/app">Your Loops</Link>
          <Link href="/app/scan">Loop Scan</Link>
          <Link href="/app/closed">Closed</Link>
        </nav>
        <div className="app-header-actions">
          <Link
            className="account-link"
            href="/app/settings"
            aria-label="Account settings"
          >
            Account
            <span className="avatar" aria-hidden="true">
              you
            </span>
          </Link>
          <SignOut compact />
        </div>
      </header>
      {children}
      <footer className="app-footer">
        <span>One less thing on your mind.</span>
        <Link href="/">loopend · Until it’s done.</Link>
      </footer>
    </div>
  );
}
