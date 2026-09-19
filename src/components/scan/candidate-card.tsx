import { LoopMark } from '../brand';
import { formatDate } from '@/domain/loops';
import type { LoopCandidate } from '@/server/db/schema';
import { CandidateActions } from './candidate-actions';
export type CandidateEvidence = {
  id: string;
  sender: string;
  subject: string;
  content: string;
  occurredAt: Date;
  conversationId: string;
};
export function CandidateCard({
  candidate,
  evidence,
}: {
  candidate: LoopCandidate;
  evidence: CandidateEvidence[];
}) {
  return (
    <article className="candidate">
      <header className="candidate-heading">
        <LoopMark />
        <div>
          <span className="eyebrow">A possible open Loop</span>
          <h2>{candidate.title}</h2>
        </div>
        <span className="candidate-confidence">
          {candidate.confidence === 'HIGH'
            ? 'Clear commitment'
            : 'Worth a look'}
        </span>
      </header>
      <p className="candidate-summary">{candidate.summary}</p>
      <dl className="candidate-facts">
        <div>
          <dt>The outcome</dt>
          <dd>{candidate.desiredOutcome}</dd>
        </div>
        <div>
          <dt>Waiting on</dt>
          <dd>{candidate.waitingOn}</dd>
        </div>
        <div>
          <dt>Expected by</dt>
          <dd>
            {candidate.expectedBy
              ? formatDate(candidate.expectedBy)
              : 'No clear date in the message'}
          </dd>
        </div>
        <div>
          <dt>What would count as finished</dt>
          <dd>{candidate.verificationCondition}</dd>
        </div>
        {candidate.nextAction && (
          <div>
            <dt>A possible next step</dt>
            <dd>{candidate.nextAction}</dd>
          </div>
        )}
      </dl>
      <p className="detection-reason">
        <span>Why this surfaced</span>
        {candidate.reason}
      </p>
      <details className="source-evidence">
        <summary>
          Read the source{' '}
          {evidence.length === 1 ? 'email' : `emails (${evidence.length})`}
        </summary>
        <p className="field-hint">
          A shortened excerpt, not the full conversation. The situation may have
          changed since this message.
        </p>
        {evidence.map((source) => (
          <div className="evidence-excerpt" key={source.id}>
            <h3>{source.subject}</h3>
            <p className="evidence-meta">
              {source.sender} · {formatDate(source.occurredAt)}
            </p>
            <blockquote>{source.content}</blockquote>
            <a
              className="text-link"
              href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(source.conversationId)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open conversation in Gmail ↗
            </a>
          </div>
        ))}
      </details>
      <CandidateActions id={candidate.id} version={candidate.version} />
    </article>
  );
}
