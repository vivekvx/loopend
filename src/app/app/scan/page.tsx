import { requireWorkspace } from '@/server/auth';
import { getDb } from '@/server/db';
import { scanStore } from '@/server/scan/store';
import { scanSetup } from '@/server/scan/config';
import { SCAN_DAYS, SCAN_MESSAGES, scanMessages } from '@/domain/scan';
import { LoopMark } from '@/components/brand';
import {
  ConnectGmail,
  DisconnectGmail,
  ScanControls,
} from '@/components/scan/scan-controls';
import { CandidateCard } from '@/components/scan/candidate-card';
export const metadata = { title: 'Loop Scan' };
export const maxDuration = 180;
const notices: Record<string, string> = {
  connected: 'Gmail connected. You choose when to scan and what to track.',
  'connection-cancelled': 'Connection cancelled. Nothing was imported.',
  'connection-failed':
    'Gmail could not be connected. Try again and allow read-only access.',
  disconnected:
    'Gmail disconnected. Tokens removed. Saved suggestions, excerpts, and Loops remain.',
  'revocation-unconfirmed':
    'Gmail disconnected and local tokens removed. Google could not confirm revocation; remove Loopend’s access in your Google Account permissions.',
};
const scanTime = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  await requireWorkspace();
  const { notice } = await searchParams;
  const setup = scanSetup();
  const { connections, candidates, evidence } =
    await scanStore(getDb()).review();
  const connected = connections.filter(
    (connection) => connection.status !== 'DISCONNECTED',
  );
  return (
    <main id="main" className="app-main scan-main">
      <div className="scan-intro">
        <div className="page-intro">
          <span className="eyebrow">Loop Scan</span>
          <h1>Find what you’ve forgotten.</h1>
          <p>
            A promise in an email. A reply that never arrived.
            <br className="desktop-break" /> Bring the unfinished things back
            into view.
          </p>
        </div>
        <LoopMark />
      </div>
      {notice && notices[notice] && (
        <p className="scan-notice" role="status">
          {notices[notice]}
        </p>
      )}
      <section className="scan-explainer">
        <div>
          <h2>A little context. A clear next step.</h2>
          <p>
            Loopend reads up to {SCAN_MESSAGES} recent messages from the last{' '}
            {SCAN_DAYS} days and looks for situations that may still be
            unfinished. You review each suggestion. Nothing becomes a Loop
            without your approval.
          </p>
        </div>
        <div className="scan-privacy">
          <span>Read-only Gmail access</span>
          <span>No sending, deleting, or changing mail</span>
          <span>Shortened excerpts shared with the configured AI provider</span>
        </div>
      </section>
      {(!setup.gmailReady || !setup.aiReady) && (
        <section className="scan-setup">
          <span className="eyebrow">One small setup step</span>
          <h2>Loop Scan isn’t connected yet.</h2>
          <p>
            {!setup.gmailReady
              ? 'Gmail connection settings need to be configured for this workspace. '
              : ''}
            {!setup.aiReady
              ? 'The AI detector needs a configured API key. '
              : ''}
            Your existing Loops work as usual.
          </p>
          <details>
            <summary>Workspace setup</summary>
            <p>
              Set{' '}
              {!setup.gmailReady && (
                <>
                  <code>APP_URL</code>, <code>GOOGLE_CLIENT_ID</code>,{' '}
                  <code>GOOGLE_CLIENT_SECRET</code>, and{' '}
                  <code>SOURCE_TOKEN_ENCRYPTION_KEY</code>.{' '}
                </>
              )}
              {!setup.aiReady && (
                <>
                  <code>LOOP_SCAN_AI_API_KEY</code> enables the detector.{' '}
                </>
              )}
              Configuration instructions are in{' '}
              <code>docs/architecture.md</code>. Keep all secrets server-side.
            </p>
          </details>
        </section>
      )}
      <section className="scan-connections" aria-label="Gmail connections">
        {connected.map((connection) => (
          <div className="scan-connection" key={connection.id}>
            <div className="connection-heading">
              <div>
                <span className="eyebrow">
                  {connection.status === 'CONNECTED'
                    ? 'Gmail connected'
                    : 'Reconnect to continue'}
                </span>
                <h2>{connection.accountEmail}</h2>
                <p>
                  {connection.lastScanAt
                    ? `Last scan ${scanTime.format(connection.lastScanAt)} UTC · ${connection.lastScanCount} messages checked`
                    : 'No scan yet. Start when you’re ready.'}
                </p>
              </div>
              {connection.status === 'CONNECTED' ? (
                <ScanControls
                  id={connection.id}
                  ready={setup.gmailReady && setup.aiReady}
                  running={
                    !!connection.scanLeaseUntil &&
                    connection.scanLeaseUntil > new Date()
                  }
                />
              ) : (
                <ConnectGmail ready={setup.gmailReady} reconnect />
              )}
            </div>
            {connection.lastScanError &&
              connection.lastScanError in scanMessages && (
                <p className="scan-feedback">
                  {
                    scanMessages[
                      connection.lastScanError as keyof typeof scanMessages
                    ]
                  }
                </p>
              )}
            <DisconnectGmail id={connection.id} />
          </div>
        ))}
        {!connected.length && (
          <div className="scan-connect-prompt">
            <LoopMark />
            <div>
              <h2>Start with your Gmail.</h2>
              <p>
                Connect securely through Google. You can disconnect at any time.
              </p>
            </div>
            <ConnectGmail ready={setup.gmailReady} />
          </div>
        )}
      </section>
      <section aria-label="Suggested Loops">
        <div className="section-heading">
          <h2>
            For your review <span className="count">{candidates.length}</span>
          </h2>
          <span className="field-hint">
            Suggestions, never automatic Loops.
          </span>
        </div>
        {candidates.length ? (
          <div className="candidate-list">
            {candidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                evidence={evidence.filter((source) =>
                  candidate.sourceReferences.includes(source.id),
                )}
              />
            ))}
          </div>
        ) : (
          <div className="scan-empty">
            <LoopMark />
            <h2>
              {connections.some((connection) => connection.lastScanAt)
                ? 'Nothing waiting for your review.'
                : 'The things worth a second look will land here.'}
            </h2>
            <p>
              {connections.some((connection) => connection.lastScanAt)
                ? 'No pending suggestions in this workspace. A bounded scan can miss things; it is not a complete audit of your inbox.'
                : 'Promised refunds, unresolved requests, unconfirmed plans. A situation and its finish line—not another inbox.'}
            </p>
          </div>
        )}
      </section>
      <details className="scan-data-details">
        <summary>What Loopend stores</summary>
        <p>
          Encrypted Google tokens, your connected email address, message/thread
          identifiers, and normalized source metadata. Suggested situations
          retain excerpts of up to 2,000 characters per cited message; uncited
          messages retain only identifiers, timestamps, and direction.
          Attachments aren’t stored or sent to the detector. The detector
          receives shortened text and minimal context, not tokens or raw
          headers.
        </p>
        <p>
          Disconnecting removes local tokens and attempts to revoke Google
          access. Saved suggestions, cited excerpts, and tracked Loops remain.
          Ignored conversations stay ignored, including after reconnecting.
          Evidence may be incomplete: review it before tracking.
        </p>
        <a
          className="text-link"
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noopener noreferrer"
        >
          Manage Google account access ↗
        </a>
      </details>
    </main>
  );
}
