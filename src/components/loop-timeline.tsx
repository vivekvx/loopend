import type { LoopEvent } from '@/server/db/schema';
import { isRoutineMonitoringEvent } from '@/lib/timeline';
import { userFacingCopy } from '@/lib/user-copy';
import { LocalDateTime } from './local-date-time';
import { MonitoringTimelineEvent } from './monitoring-timeline-event';

function TimelineEntry({ event }: { event: LoopEvent }) {
  const body =
    event.type === 'loop.created'
      ? 'Loop opened.'
      : event.type === 'source.accepted'
        ? 'You tracked this Loop from Gmail.'
        : userFacingCopy(event.body);
  const actor = event.actor === 'user' ? 'You' : event.actor;

  return (
    <li className={event.type === 'loop.closed' ? 'timeline-closed' : ''}>
      <span className="timeline-point" />
      <time dateTime={event.occurredAt.toISOString()}>
        <LocalDateTime value={event.occurredAt} /> · {actor}
      </time>
      <p>
        <MonitoringTimelineEvent
          type={event.type}
          body={body}
          payload={event.payload}
        />
      </p>
      {event.type === 'outcome.verified' && (
        <span className="verified-label">Completion evidence</span>
      )}
    </li>
  );
}

export function LoopTimeline({ events }: { events: LoopEvent[] }) {
  const milestones = events.filter(
    (event) => !isRoutineMonitoringEvent(event.type),
  );
  const activity = events.filter((event) =>
    isRoutineMonitoringEvent(event.type),
  );

  return (
    <>
      <ol className="timeline">
        {milestones.map((event) => (
          <TimelineEntry key={event.id} event={event} />
        ))}
      </ol>
      {activity.length > 0 && (
        <details className="timeline-activity">
          <summary>Show monitoring activity ({activity.length})</summary>
          <ol className="timeline timeline-routine">
            {activity.map((event) => (
              <TimelineEntry key={event.id} event={event} />
            ))}
          </ol>
        </details>
      )}
    </>
  );
}
