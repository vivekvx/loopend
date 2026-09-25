import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { workspaceQueries } from '@/server/loops/queries';
import { formatDate } from '@/domain/loops';
import { LoopStatusLabel } from '@/components/loop-status';
import { LoopMark } from '@/components/brand';
import { ActivityForm, CompletionForm } from '@/components/activity-form';
import { MonitoringPanel } from '@/components/monitoring-panel';
import { LoopTimeline } from '@/components/loop-timeline';
import { LocalDateTime } from '@/components/local-date-time';
import { boundedExcerpt, userFacingCopy } from '@/lib/user-copy';
export default async function LoopDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const record = await (await workspaceQueries()).get(id);
  if (!record) notFound();
  const { loop, events, evidence } = record;
  const possibleOutcome = [...events]
    .reverse()
    .find((event) => event.type === 'agent.possible_outcome_detected');
  const reviewEvidence = evidence.slice(-5);
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
          <MonitoringPanel loop={loop} delayed={record.monitoringDelayed} />
          {loop.status !== 'CLOSED' && (
            <Link
              href={`/app/loops/${id}/edit`}
              className="button button-outline button-small"
            >
              Edit details & state <span aria-hidden="true">↗</span>
            </Link>
          )}
          {loop.status === 'VERIFYING' && (
            <>
              <section
                className="verifying-panel"
                aria-labelledby="verify-title"
              >
                <span className="eyebrow">Ready to verify</span>
                <h2 id="verify-title">This may be finished.</h2>
                <p>Loopend found evidence that the outcome may be complete.</p>
                <dl>
                  <div>
                    <dt>Completion condition</dt>
                    <dd>{loop.verificationCondition}</dd>
                  </div>
                </dl>
                {reviewEvidence.length > 0 && (
                  <details className="evidence-review">
                    <summary>
                      Review evidence ({reviewEvidence.length}
                      {reviewEvidence.length < evidence.length
                        ? ` of ${evidence.length}`
                        : ''}
                      )
                    </summary>
                    {reviewEvidence.map((item) => (
                      <article key={item.id}>
                        <span className="evidence-source">Gmail</span>
                        <strong>{item.subject || 'Message from Gmail'}</strong>
                        <span>
                          {item.sender || 'Gmail sender'} ·{' '}
                          <LocalDateTime value={item.occurredAt} />
                        </span>
                        <p>
                          {boundedExcerpt(item.content) ||
                            'Message metadata only'}
                        </p>
                        {possibleOutcome && (
                          <p className="evidence-reason">
                            <span>Why it matters</span>
                            {userFacingCopy(possibleOutcome.body)}
                          </p>
                        )}
                      </article>
                    ))}
                  </details>
                )}
              </section>
              <CompletionForm
                id={id}
                version={loop.version}
                condition={loop.verificationCondition}
              />
            </>
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
                <span className="eyebrow">Closed</span>
                <h2>One less open Loop.</h2>
                <p>
                  Verified <LocalDateTime value={loop.closedAt} />
                </p>
                {events
                  .filter((event) => event.type === 'outcome.verified')
                  .slice(-1)
                  .map((event) => (
                    <p className="closed-evidence" key={event.id}>
                      <span>Evidence</span>
                      {userFacingCopy(event.body)}
                    </p>
                  ))}
              </div>
            </div>
          )}
        </div>
        <section className="timeline-section">
          <div className="section-heading">
            <h2>The story so far</h2>
            <span className="count">{events.length}</span>
          </div>
          <LoopTimeline events={events} />
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
