import { statusLabels, type LoopStatus } from '@/domain/loops';
export function LoopStatusLabel({ status }: { status: LoopStatus }) {
  return (
    <span className={`status status-${status.toLowerCase()}`}>
      <span className="status-dot" />
      {statusLabels[status]}
    </span>
  );
}
