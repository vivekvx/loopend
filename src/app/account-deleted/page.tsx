import Link from 'next/link';

export default async function AccountDeleted({
  searchParams,
}: {
  searchParams: Promise<{ revocation?: string }>;
}) {
  const { revocation } = await searchParams;
  return (
    <main id="main" className="app-main">
      <div className="page-intro">
        <h1>Your account has been deleted.</h1>
        <p>Your active data and sign-ins have been removed.</p>
      </div>
      {revocation === 'unconfirmed' && (
        <p>
          Local Gmail tokens were erased, but Google revocation could not be
          confirmed.{' '}
          <a
            className="text-link"
            href="https://myaccount.google.com/permissions"
            rel="noreferrer"
          >
            Remove Loopend from your Google account permissions.
          </a>
        </p>
      )}
      <Link className="text-link" href="/">
        Return to loopend
      </Link>
    </main>
  );
}
