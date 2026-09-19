export default function ScanLoading() {
  return (
    <main id="main" className="app-main" aria-busy="true">
      <p className="eyebrow">Gathering your suggestions…</p>
      <div className="skeleton skeleton-title" />
      <div className="skeleton" />
      <div className="skeleton" />
    </main>
  );
}
