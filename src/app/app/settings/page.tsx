import Link from 'next/link';
import { requireWorkspace } from '@/server/auth';
import { getDb } from '@/server/db';
import { scanStore } from '@/server/scan/store';
import { DisconnectGmail } from '@/components/scan/scan-controls';
import { SignOut } from '@/components/auth/sign-out';
import { DeleteAccount } from '@/components/auth/delete-account';
import { safeRead } from '@/server/errors';
export const metadata = { title: 'Your account' };

export default async function SettingsPage() {
  const { user } = await requireWorkspace();
  const connections = await safeRead(() =>
    scanStore(getDb(), user.id).connections(),
  );
  const connected = connections.filter(
    (connection) => connection.status !== 'DISCONNECTED',
  );
  return (
    <main id="main" className="app-main settings-main">
      <div className="page-intro">
        <span className="eyebrow">Your account</span>
        <h1>A space that’s yours.</h1>
        <p>Your identity, your connections, your say.</p>
      </div>
      <section className="settings-section">
        <h2>Signed in as</h2>
        <div>
          <p className="account-name">{user.name}</p>
          <p>{user.email}</p>
          <p className="field-hint">
            Your Loops and email evidence are private to this account.
          </p>
        </div>
      </section>
      <section className="settings-section">
        <h2>Gmail</h2>
        <div>
          {connected.length ? (
            connected.map((connection) => (
              <div className="settings-connection" key={connection.id}>
                <p>{connection.accountEmail}</p>
                <p className="field-hint">
                  {connection.status === 'CONNECTED'
                    ? 'Connected · read-only access'
                    : 'Authorization expired · reconnect in Loop Scan'}
                </p>
                <DisconnectGmail id={connection.id} />
              </div>
            ))
          ) : (
            <p>No Gmail account connected.</p>
          )}
          <Link href="/app/scan" className="text-link">
            Manage in Loop Scan ↗
          </Link>
        </div>
      </section>
      <section className="settings-section">
        <h2>Until next time</h2>
        <div>
          <p className="settings-signout-copy">
            Signing out ends this session. Your Loops stay here.
          </p>
          <SignOut />
        </div>
      </section>
      <section className="settings-section">
        <h2>Your data</h2>
        <div>
          <DeleteAccount />
        </div>
      </section>
    </main>
  );
}
