'use client';
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="app-main">
      <div className="page-intro">
        <span className="eyebrow">A momentary pause</span>
        <h1>Couldn’t gather your Loops.</h1>
        <p>
          Your records haven’t been changed. Check your connection and try
          again.
        </p>
      </div>
      <button className="button" onClick={reset}>
        Try again ↗
      </button>
    </main>
  );
}
