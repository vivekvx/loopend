'use client';

import { useActionState } from 'react';
import type { Loop } from '@/server/db/schema';
import { configureMonitoring } from '@/server/agent/actions';
import { formatDate } from '@/domain/loops';

function inputTime(value: Date | null) {
  if (!value) return '';
  return value.toISOString().slice(0, 16);
}

export function MonitoringPanel({
  loop,
  delayed = false,
}: {
  loop: Loop;
  delayed?: boolean;
}) {
  const [state, action, pending] = useActionState(configureMonitoring, {});
  const gmail = loop.monitoringSource === 'GMAIL_CONVERSATION';
  const canEnable = gmail || loop.monitoringEnabled;
  return (
    <section className="monitoring-panel" aria-labelledby="monitoring-title">
      <div className="monitoring-heading">
        <div>
          <span className="eyebrow">Monitoring</span>
          <h2 id="monitoring-title">
            {loop.monitoringEnabled
              ? 'Loopend is keeping watch.'
              : 'Quiet until you ask.'}
          </h2>
        </div>
        <span
          className={
            loop.monitoringEnabled ? 'monitoring-live' : 'monitoring-paused'
          }
        >
          {loop.monitoringEnabled ? 'Watching' : 'Paused'}
        </span>
      </div>
      <p>
        {loop.monitoringEnabled
          ? 'Loopend checks only the linked Gmail conversation. It never sends messages or closes this Loop.'
          : canEnable
            ? 'Let Loopend re-check the linked Gmail conversation after a calm, chosen interval.'
            : 'Monitoring becomes available for Loops you choose to track from Loop Scan.'}
      </p>
      {loop.monitoringEnabled && (
        <dl className="monitoring-facts">
          <div>
            <dt>Source</dt>
            <dd>Gmail conversation</dd>
          </div>
          <div>
            <dt>Next check</dt>
            <dd>{formatDate(loop.monitoringNextCheckAt)}</dd>
          </div>
          <div>
            <dt>Last check</dt>
            <dd>{formatDate(loop.monitoringLastCheckAt)}</dd>
          </div>
          <div>
            <dt>Waiting for</dt>
            <dd>{loop.waitingOn || 'The expected outcome'}</dd>
          </div>
        </dl>
      )}
      {loop.monitoringLastObservation && (
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
      {canEnable && loop.status !== 'CLOSED' && (
        <>
          <form action={action} className="monitoring-form">
            <input type="hidden" name="id" value={loop.id} />
            <input type="hidden" name="version" value={loop.version} />
            <input type="hidden" name="enabled" value="true" />
            <div className="monitoring-controls">
              <label>
                Check every
                <select
                  name="cadenceHours"
                  defaultValue={loop.monitoringCadenceHours}
                >
                  <option value="24">day</option>
                  <option value="72">3 days</option>
                  <option value="168">week</option>
                </select>
              </label>
              <label>
                First check after
                <input
                  name="nextCheckAt"
                  type="datetime-local"
                  defaultValue={inputTime(loop.monitoringNextCheckAt)}
                />
              </label>
            </div>
            <button
              className="button button-outline button-small"
              disabled={pending}
            >
              {pending
                ? 'Saving…'
                : loop.monitoringEnabled
                  ? 'Update next check'
                  : 'Enable monitoring'}
            </button>
          </form>
          {loop.monitoringEnabled && (
            <form action={action} className="monitoring-pause-form">
              <input type="hidden" name="id" value={loop.id} />
              <input type="hidden" name="version" value={loop.version} />
              <input type="hidden" name="enabled" value="false" />
              <input
                type="hidden"
                name="cadenceHours"
                value={loop.monitoringCadenceHours}
              />
              <button className="text-link" disabled={pending}>
                Pause monitoring
              </button>
            </form>
          )}
        </>
      )}
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.message && (
        <p className="monitoring-message" role="status">
          {state.message}
        </p>
      )}
    </section>
  );
}
