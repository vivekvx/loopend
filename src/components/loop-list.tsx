import Link from 'next/link';
import type { Loop } from '@/server/db/schema';
import { formatDate } from '@/domain/loops';
import { LoopMark } from './brand';
import { LoopStatusLabel } from './loop-status';
export function LoopList({ loops, empty }: { loops: Loop[]; empty: string }) {
  if (!loops.length) return <p className="empty-line">{empty}</p>;
  return (
    <ul className="loop-list">
      {loops.map((loop) => (
        <li key={loop.id}>
          <Link className="loop-row" href={`/app/loops/${loop.id}`}>
            <LoopMark closed={loop.status === 'CLOSED'} />
            <div className="loop-row-copy">
              <h3>{loop.title}</h3>
              <p>
                {loop.monitoringEnabled && loop.status !== 'CLOSED'
                  ? `Loopend is watching · ${loop.waitingOn || loop.desiredOutcome}`
                  : loop.status === 'CLOSED'
                    ? loop.desiredOutcome
                    : loop.waitingOn
                      ? `Waiting on ${loop.waitingOn}`
                      : loop.desiredOutcome}
              </p>
            </div>
            <div className="loop-row-meta">
              <LoopStatusLabel status={loop.status} />
              <span>
                {loop.status === 'CLOSED'
                  ? `Closed ${formatDate(loop.closedAt)}`
                  : loop.expectedBy
                    ? `Expected ${formatDate(loop.expectedBy)}`
                    : 'No date set'}
              </span>
            </div>
            <span className="row-arrow" aria-hidden="true">
              ↗
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
