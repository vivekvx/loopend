'use client';
import Link from 'next/link';
export default function AppError({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="form-page">
      <div className="page-intro">
        <span className="eyebrow">A momentary pause</span>
        <h1>Something needs a second look.</h1>
        <p>We couldn’t open this page. Please try again in a moment.</p>
      </div>
      <div className="form-actions">
        <button className="button" onClick={reset}>
          Try again ↗
        </button>
        <Link href="/" className="text-link">
          Back home
        </Link>
      </div>
    </main>
  );
}
