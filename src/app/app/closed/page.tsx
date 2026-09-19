import { workspaceQueries } from '@/server/loops/queries';
import { LoopList } from '@/components/loop-list';
export default async function ClosedPage() {
  const loops = (await (await workspaceQueries()).list()).filter(
    (loop) => loop.status === 'CLOSED',
  );
  return (
    <main id="main" className="app-main">
      <div className="page-intro">
        <span className="eyebrow">A little less to carry</span>
        <h1>Finished. For real.</h1>
        <p>Verified outcomes, with the whole story kept safe.</p>
      </div>
      <LoopList
        loops={loops}
        empty="No closed Loops yet. A Loop lands here only after you verify the outcome."
      />
    </main>
  );
}
