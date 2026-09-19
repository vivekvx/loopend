import Link from 'next/link';
import { workspaceQueries } from '@/server/loops/queries';
import { needsAttention } from '@/domain/loops';
import { LoopList } from '@/components/loop-list';
import { LoopMark } from '@/components/brand';
export default async function Dashboard() {
  const loops = await (await workspaceQueries()).list();
  const active = loops.filter((loop) => loop.status !== 'CLOSED');
  const needsYou = active.filter((loop) => needsAttention(loop));
  const handled = active.filter((loop) => !needsAttention(loop));
  const closed = loops.filter((loop) => loop.status === 'CLOSED').slice(0, 3);
  return (
    <main id="main" className="app-main">
      <div className="dashboard-intro">
        <div>
          <span className="eyebrow">A little more peace of mind</span>
          <h1>
            {needsYou.length ? (
              <>
                {needsYou.length === 1
                  ? 'One thing needs'
                  : `${needsYou.length} things need`}
                <br />a little attention.
              </>
            ) : (
              <>
                Nothing urgent
                <br />
                needs you today.
              </>
            )}
          </h1>
          <p>
            {active.length
              ? `${active.length} open ${active.length === 1 ? 'Loop' : 'Loops'}. All in one place. None to keep in your head.`
              : 'A place for the things that haven’t quite finished.'}
          </p>
        </div>
        <div className="dashboard-sigil" aria-hidden="true">
          <LoopMark />
          <span>
            Room to
            <br />
            breathe.
          </span>
        </div>
      </div>
      <div className="section-heading">
        <h2>
          Your open Loops <span className="count">{active.length}</span>
        </h2>
        <Link className="button button-small" href="/app/loops/new">
          New Loop <span aria-hidden="true">+</span>
        </Link>
      </div>
      <section className="loop-section">
        <div className="group-heading">
          <h2>
            Needs you <span>{needsYou.length.toString().padStart(2, '0')}</span>
          </h2>
          <p>A decision, a check-in, or an expected date that’s here.</p>
        </div>
        <LoopList
          loops={needsYou}
          empty="You’re clear here. Nothing needs your attention."
        />
      </section>
      <section className="loop-section">
        <div className="group-heading">
          <h2>
            Being handled{' '}
            <span>{handled.length.toString().padStart(2, '0')}</span>
          </h2>
          <p>Open, waiting, or on the way to a verified outcome.</p>
        </div>
        <LoopList
          loops={handled}
          empty="When you open a Loop, we’ll keep the whole story here."
        />
      </section>
      <section className="loop-section closed-section">
        <div className="group-heading">
          <h2>
            Recently closed{' '}
            <span>{closed.length.toString().padStart(2, '0')}</span>
          </h2>
          <Link className="text-link" href="/app/closed">
            See all closed <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <LoopList
          loops={closed}
          empty="The best part goes here: things that actually finished."
        />
      </section>
    </main>
  );
}
