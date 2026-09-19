import Link from 'next/link';
export function LoopMark({
  closed = false,
  className = '',
}: {
  closed?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={`loop-mark ${className}`}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="20"
        cy="20"
        r="15"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={closed ? undefined : '77 18'}
        transform="rotate(-62 20 20)"
      />
    </svg>
  );
}
export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="loopend home">
      <LoopMark />
      <span>loopend</span>
    </Link>
  );
}
