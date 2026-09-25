'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Loop } from '@/server/db/schema';
import {
  configureMonitoring,
  type MonitoringActionState,
} from '@/server/agent/actions';
import { LocalDateTime, useBrowserLocalTime } from './local-date-time';
import {
  localDateTimeInputValue,
  localDateTimeToUtcIso,
} from '@/lib/monitoring-time';

function MonitoringScheduleForm({
  id,
  monitoringGeneration,
  cadenceHours: initialCadenceHours,
  nextCheckAt,
  action,
  pending,
  enabled,
  state,
}: {
  id: string;
  monitoringGeneration: number;
  cadenceHours: number;
  nextCheckAt: Date | string | null;
  action: (formData: FormData) => void;
  pending: boolean;
  enabled: boolean;
  state: MonitoringActionState;
}) {
  const browserReady = useBrowserLocalTime();
  const [draftNextCheckAt, setDraftNextCheckAt] = useState<string | null>(null);
  const [cadenceHours, setCadenceHours] = useState(String(initialCadenceHours));
  const [clientError, setClientError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const initialNextCheckAt =
    browserReady && nextCheckAt ? localDateTimeInputValue(nextCheckAt) : '';
  const nextCheckLocal = draftNextCheckAt ?? initialNextCheckAt;
  const minimumLocal = browserReady
    ? localDateTimeInputValue(new Date())
    : undefined;

  function submitSchedule(form: HTMLFormElement) {
    const serialized = form.elements.namedItem('nextCheckAt');
    if (!(serialized instanceof HTMLInputElement)) return false;
    try {
      serialized.value = nextCheckLocal
        ? localDateTimeToUtcIso(nextCheckLocal)
        : '';
      setClientError(null);
      return true;
    } catch {
      setClientError('Choose a valid local date and time.');
      return false;
    }
  }

  return (
    <>
      <form
        action={action}
        className="monitoring-form"
        onSubmit={(event) => {
          if (!submitSchedule(event.currentTarget)) event.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={id} />
        <input
          type="hidden"
          name="monitoringGeneration"
          value={monitoringGeneration}
        />
        <input type="hidden" name="enabled" value="true" />
        <input type="hidden" name="nextCheckAt" />
        <div className="monitoring-controls">
          <label>
            Check every
            <select
              name="cadenceHours"
              value={cadenceHours}
              onChange={(event) => {
                setCadenceHours(event.target.value);
                setDirty(true);
              }}
              disabled={pending}
            >
              <option value="24">day</option>
              <option value="72">3 days</option>
              <option value="168">week</option>
            </select>
          </label>
          <label>
            First check after
            <input
              aria-label="First check after, local time"
              name="nextCheckLocal"
              type="datetime-local"
              value={nextCheckLocal}
              min={minimumLocal}
              onChange={(event) => {
                setDraftNextCheckAt(event.target.value);
                setClientError(null);
                setDirty(true);
              }}
              onInvalid={() => {
                setClientError('Choose a future local date and time.');
                setDirty(true);
              }}
              disabled={pending}
              suppressHydrationWarning
            />
          </label>
        </div>
        <button
          className="button button-outline button-small"
          disabled={pending}
        >
          {pending
            ? 'Saving...'
            : enabled
              ? 'Update next check'
              : 'Enable monitoring'}
        </button>
      </form>
      {(clientError || state.error) && (
        <p className="form-error" role="alert">
          {clientError || state.error}
        </p>
      )}
      {state.message && !clientError && !dirty && (
        <p className="monitoring-message" role="status">
          {state.message}
        </p>
      )}
    </>
  );
}

export function MonitoringPanel({
  loop,
  delayed = false,
}: {
  loop: Loop;
  delayed?: boolean;
}) {
  const [state, action, pending] = useActionState(configureMonitoring, {});
  const router = useRouter();
  const refreshedConflict = useRef(false);
  const gmail = loop.monitoringSource === 'GMAIL_CONVERSATION';
  const canEnable = gmail || loop.monitoringEnabled;
  const activelyWatching =
    loop.monitoringEnabled &&
    (loop.status === 'WAITING' || loop.status === 'AGENT_WORKING');
  const monitoringGeneration =
    state.monitoringGeneration ?? loop.monitoringGeneration;
  const cadenceHours = state.cadenceHours ?? loop.monitoringCadenceHours;
  const nextCheckAt =
    state.nextCheckAt === undefined
      ? loop.monitoringNextCheckAt
      : state.nextCheckAt;

  useEffect(() => {
    if (!state.conflict) {
      refreshedConflict.current = false;
      return;
    }
    if (refreshedConflict.current) return;
    refreshedConflict.current = true;
    router.refresh();
  }, [router, state.conflict]);

  if (loop.status === 'CLOSED') return null;

  return (
    <section className="monitoring-panel" aria-labelledby="monitoring-title">
      <div className="monitoring-heading">
        <div>
          <span className="eyebrow">Monitoring</span>
          <h2 id="monitoring-title">
            {activelyWatching
              ? 'Loopend is keeping watch.'
              : loop.status === 'VERIFYING'
                ? 'Your review comes next.'
                : 'Quiet until you ask.'}
          </h2>
        </div>
        <span
          className={activelyWatching ? 'monitoring-live' : 'monitoring-paused'}
        >
          {activelyWatching
            ? 'Watching'
            : loop.status === 'VERIFYING'
              ? 'Reviewing'
              : 'Paused'}
        </span>
      </div>
      <p>
        {activelyWatching
          ? 'Loopend checks only the linked Gmail conversation. It never sends messages or closes this Loop.'
          : loop.status === 'VERIFYING'
            ? 'Monitoring is paused while you review the evidence and decide what happens next.'
            : canEnable
              ? 'Let Loopend re-check the linked Gmail conversation after a calm, chosen interval.'
              : 'Monitoring becomes available for Loops you choose to track from Loop Scan.'}
      </p>
      {activelyWatching && (
        <dl className="monitoring-facts">
          <div>
            <dt>Last checked</dt>
            <dd>
              <LocalDateTime value={loop.monitoringLastCheckAt} />
            </dd>
          </div>
          <div>
            <dt>Next check</dt>
            <dd>
              <LocalDateTime value={nextCheckAt} />
            </dd>
          </div>
          <div>
            <dt>Waiting for</dt>
            <dd>{loop.waitingOn || 'The expected outcome'}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>Gmail conversation</dd>
          </div>
        </dl>
      )}
      {activelyWatching && loop.monitoringLastObservation && (
        <p className="monitoring-observation">
          <span>Latest observation</span>
          {loop.monitoringLastObservation}
        </p>
      )}
      {delayed && (
        <p role="status" className="monitoring-message">
          This check is delayed. Your Loop is saved; monitoring will resume when
          the service is available.
        </p>
      )}
      {canEnable && loop.status !== 'VERIFYING' && (
        <>
          <MonitoringScheduleForm
            key={`${monitoringGeneration}:${nextCheckAt ?? 'none'}:${cadenceHours}`}
            id={loop.id}
            monitoringGeneration={monitoringGeneration}
            cadenceHours={cadenceHours}
            nextCheckAt={nextCheckAt}
            action={action}
            pending={pending}
            enabled={loop.monitoringEnabled}
            state={state}
          />
          {activelyWatching && (
            <form action={action} className="monitoring-pause-form">
              <input type="hidden" name="id" value={loop.id} />
              <input
                type="hidden"
                name="monitoringGeneration"
                value={monitoringGeneration}
              />
              <input type="hidden" name="enabled" value="false" />
              <input type="hidden" name="cadenceHours" value={cadenceHours} />
              <button className="text-link" disabled={pending}>
                Pause monitoring
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
