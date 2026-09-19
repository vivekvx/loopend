export default function Loading() {
  return (
    <main id="main" className="app-main" aria-busy="true">
      <p className="eyebrow">Gathering your Loops…</p>
      <div className="skeleton skeleton-title" />
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </main>
  );
}
