import { Brand } from '@/components/brand';
import { AccessForm } from './access-form';
export default function AccessPage() {
  return (
    <main id="main" className="form-page">
      <Brand />
      <div className="page-intro">
        <span className="eyebrow">Your personal space</span>
        <h1>Leave the noise outside.</h1>
        <p>Enter your password to return to your Loops.</p>
      </div>
      <AccessForm />
    </main>
  );
}
