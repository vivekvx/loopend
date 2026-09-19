import Link from 'next/link';
export default function NotFound() {
  return (
    <main id="main" className="form-page">
      <div className="page-intro">
        <span className="eyebrow">A loose end</span>
        <h1>This page isn’t here.</h1>
        <p>The Loop may not exist, or the link may be incomplete.</p>
      </div>
      <Link className="button" href="/app">
        Back to your Loops ↗
      </Link>
    </main>
  );
}
