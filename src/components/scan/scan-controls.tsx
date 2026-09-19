'use client';
import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  connectGmail,
  scanGmail,
  disconnectGmail,
  type ScanActionState,
} from '@/server/scan/actions';

function Feedback({ state }: { state: ScanActionState }) {
  return (
    <>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.message && (
        <p className="scan-feedback" role="status">
          {state.message}
        </p>
      )}
    </>
  );
}
export function ConnectGmail({
  ready,
  reconnect = false,
}: {
  ready: boolean;
  reconnect?: boolean;
}) {
  const [state, action, pending] = useActionState(connectGmail, {});
  return (
    <form action={action} className="scan-control">
      <button className="button button-small" disabled={!ready || pending}>
        {pending
          ? 'Opening Google…'
          : reconnect
            ? 'Reconnect Gmail'
            : 'Connect Gmail'}
        <span aria-hidden="true">↗</span>
      </button>
      <Feedback state={state} />
    </form>
  );
}
export function ScanControls({
  id,
  ready,
  running,
}: {
  id: string;
  ready: boolean;
  running: boolean;
}) {
  const [state, action, pending] = useActionState(scanGmail, {});
  const router = useRouter();
  useEffect(() => {
    if (!running && !pending) return;
    const interval = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(interval);
  }, [running, pending, router]);
  return (
    <form action={action} className="scan-control">
      <input type="hidden" name="connectionId" value={id} />
      <button
        className="button button-small"
        disabled={!ready || running || pending}
      >
        {running || pending
          ? 'Looking for loose ends…'
          : 'Scan recent messages'}
        <span aria-hidden="true">↗</span>
      </button>
      <Feedback state={state} />
      {(running || pending) && (
        <p className="field-hint" role="status">
          Reading a bounded recent window. Nothing is tracked automatically.
        </p>
      )}
    </form>
  );
}
export function DisconnectGmail({ id }: { id: string }) {
  const [state, action, pending] = useActionState(disconnectGmail, {});
  return (
    <details className="disconnect-details">
      <summary>Disconnect Gmail</summary>
      <p>
        This removes stored tokens and stops future scans. Saved suggestions,
        short email excerpts, and tracked Loops stay in your private workspace.
      </p>
      <form action={action}>
        <input type="hidden" name="connectionId" value={id} />
        <button
          className="button button-outline button-small"
          disabled={pending}
        >
          {pending ? 'Disconnecting…' : 'Disconnect this account'}
        </button>
        <Feedback state={state} />
      </form>
    </details>
  );
}
