import Link from 'next/link';
import { LoopForm } from '@/components/loop-form';
export const metadata = { title: 'Open a Loop' };
export default function NewLoopPage() {
  return (
    <main id="main" className="form-page">
      <Link className="back-link" href="/app">
        ← Your Loops
      </Link>
      <div className="page-intro">
        <span className="eyebrow">Get it out of your head</span>
        <h1>What’s still open?</h1>
        <p>Start with the situation. Give it a finish line.</p>
      </div>
      <LoopForm />
    </main>
  );
}
