import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { z } from 'zod';
import { LoopForm } from '@/components/loop-form';
import { workspaceQueries } from '@/server/loops/queries';
export default async function EditLoopPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const record = await (await workspaceQueries()).get(id);
  if (!record) notFound();
  if (record.loop.status === 'CLOSED') redirect(`/app/loops/${id}`);
  return (
    <main id="main" className="form-page">
      <Link className="back-link" href={`/app/loops/${id}`}>
        ← Back to the Loop
      </Link>
      <div className="page-intro">
        <span className="eyebrow">Keep the story current</span>
        <h1>A step closer.</h1>
        <p>Update what’s changed. The finish line stays in view.</p>
      </div>
      <LoopForm loop={record.loop} />
    </main>
  );
}
