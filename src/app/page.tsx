import Link from 'next/link';
import { Brand, LoopMark } from '@/components/brand';
import { HeroVisual } from '@/components/marketing/hero-visual';
import { Story } from '@/components/marketing/story';
export default function LandingPage() {
  return (
    <>
      <header className="marketing-header">
        <Brand />
        <nav aria-label="Main">
          <a href="#how-it-works">How it works</a>
          <a href="#open-ends">Made for real life</a>
        </nav>
        <Link className="header-cta" href="/app">
          Enter your space <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <main id="main">
        <section className="landing-hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="live-dot" /> YOUR PERSONAL COMPLETION AGENT
            </span>
            <h1>
              Things start.
              <br />
              loopend makes
              <br />
              sure they <em>finish.</em>
            </h1>
            <p>
              The refund. The repair. The “I’ll get back to you.”
              <br className="desktop-break" /> A home for everything that’s
              still open.
              <br className="desktop-break" /> And a way to see it through.
            </p>
            <Link className="button hero-cta" href="/app">
              Find my open loops <span aria-hidden="true">↗</span>
            </Link>
            <span className="cta-note">
              Start with one Loop. A little less on your mind.
            </span>
          </div>
          <HeroVisual />
          <div className="hero-bottom">
            <span>UNTIL IT’S DONE.</span>
            <a href="#how-it-works">
              A little further, a little lighter{' '}
              <span aria-hidden="true">↓</span>
            </a>
            <span>LESS MENTAL TABS. MORE LIFE.</span>
          </div>
        </section>
        <section className="open-ends-section" id="open-ends">
          <div>
            <span className="eyebrow">You know the feeling</span>
            <h2>
              Not on your list.
              <br />
              <em>Still on your mind.</em>
            </h2>
          </div>
          <div className="open-ends-copy">
            <p>
              Life leaves things open. Most tools help you remember to do
              something. Loopend helps you remember what still needs to happen.
            </p>
            <div className="situation-list">
              <span>Refunds</span>
              <span>Repairs</span>
              <span>Applications</span>
              <span>Appointments</span>
              <span>Documents</span>
              <span>Promises</span>
            </div>
          </div>
        </section>
        <Story />
        <section className="promise-section">
          <LoopMark closed />
          <span className="eyebrow">A quieter kind of productive</span>
          <h2>
            Less chasing.
            <br />
            <em>More living.</em>
          </h2>
          <p>
            Loopend remembers what hasn’t finished, takes the next step,
            <br className="desktop-break" /> and stays on it until it’s done.
          </p>
          <Link className="button" href="/app">
            Find my open loops <span aria-hidden="true">↗</span>
          </Link>
          <span className="cta-note">
            Your workspace starts with manual Loops.
            <br />
            Connected inboxes and agent follow-ups are the next chapter.
          </span>
        </section>
      </main>
      <footer className="marketing-footer">
        <Brand />
        <span>Until it’s done.</span>
        <a href="#main">Back to the beginning ↑</a>
      </footer>
    </>
  );
}
