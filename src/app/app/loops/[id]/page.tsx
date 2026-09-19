import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { workspaceQueries } from '@/server/loops/queries';
import { formatDate } from '@/domain/loops';
import { LoopStatusLabel } from '@/components/loop-status';
import { LoopMark } from '@/components/brand';
import { ActivityForm, CompletionForm } from '@/components/activity-form';
export default async function LoopDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const record = await (await workspaceQueries()).get(id);
  if (!record) notFound();
  const { loop, events } = record;
  return (
    <main id="main" className="detail-main">
      <Link className="back-link" href="/app">
        ← Your Loops
      </Link>
      <header className="detail-header">
        <div>
          <LoopStatusLabel status={loop.status} />
          <h1>{loop.title}</h1>
          <p>
            {loop.summary ||
              'An unfinished situation, with a finish line in sight.'}
          </p>
        </div>
        <LoopMark closed={loop.status === 'CLOSED'} />
      </header>
      <div className="detail-grid">
        <div>
          <section className="outcome-section">
            <span className="eyebrow">The finish line</span>
            <h2>{loop.desiredOutcome}</h2>
          </section>
          <dl className="detail-facts">
            <div>
              <dt>Waiting on</dt>
              <dd>{loop.waitingOn || 'No one specified yet'}</dd>
            </div>
            <div>
              <dt>Expected by</dt>
              <dd>{formatDate(loop.expectedBy)}</dd>
            </div>
            <div className="full">
              <dt>Next action</dt>
              <dd>{loop.nextAction || 'Decide the next step.'}</dd>
            </div>
            <div className="full">
              <dt>How we’ll know it’s done</dt>
              <dd>{loop.verificationCondition}</dd>
            </div>
          </dl>
          {loop.status !== 'CLOSED' && (
            <Link
              href={`/app/loops/${id}/edit`}
              className="button button-outline button-small"
            >
              Edit details & state <span aria-hidden="true">↗</span>
            </Link>
          )}
          {loop.status === 'VERIFYING' && (
            <CompletionForm
              id={id}
              version={loop.version}
              condition={loop.verificationCondition}
            />
          )}
          {loop.status !== 'CLOSED' && loop.status !== 'VERIFYING' && (
            <p className="completion-note">
              When the outcome appears to have happened, change the state to{' '}
              <strong>Verifying</strong>. Check the evidence, then close the
              Loop.
            </p>
          )}
          {loop.status === 'CLOSED' && (
            <div className="closed-banner">
              <LoopMark closed />
              <div>
                <h2>One less open Loop.</h2>
                <p>Verified and closed on {formatDate(loop.closedAt)}.</p>
              </div>
            </div>
          )}
        </div>
        <section className="timeline-section">
          <div className="section-heading">
            <h2>The story so far</h2>
            <span className="count">{events.length}</span>
          </div>
          <ol className="timeline">
            {events.map((event) => (
              <li
                key={event.id}
                className={
                  event.type === 'loop.closed' ? 'timeline-closed' : ''
                }
              >
                <span className="timeline-point" />
                <time dateTime={event.occurredAt.toISOString()}>
                  {formatDate(event.occurredAt)} ·{' '}
                  {event.actor === 'user' ? 'You' : event.actor}
                </time>
                <p>{event.body}</p>
                {event.type === 'outcome.verified' && (
                  <span className="verified-label">Completion evidence</span>
                )}
              </li>
            ))}
          </ol>
          {loop.status !== 'CLOSED' && (
            <ActivityForm key={loop.version} id={id} version={loop.version} />
          )}
        </section>
      </div>
      <p className="record-meta">
        Opened {formatDate(loop.createdAt)} · Updated{' '}
        {formatDate(loop.updatedAt)}
      </p>
    </main>
  );
}
