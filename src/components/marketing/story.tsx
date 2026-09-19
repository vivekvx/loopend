const steps = [
  {
    stage: 'Detect',
    title: 'It starts in a dozen places.',
    text: 'A receipt in your inbox. A date in your calendar. A promise buried in a message. The pieces of one unfinished story.',
    note: 'Email · Order #1048 · “Refund on its way”',
  },
  {
    stage: 'Understand',
    title: 'One situation. A clear finish line.',
    text: 'The email isn’t the thing to finish. Getting your £128 back is. A Loop holds the context, the expectation, and what done actually means.',
    note: 'Desired outcome → £128 returned to your account',
  },
  {
    stage: 'Wait',
    title: 'Five days pass. Nothing arrives.',
    text: 'Waiting is a real state, not a forgotten task. The expected date stays attached to the outcome, so a missed promise doesn’t disappear.',
    note: 'Expected Friday · Still no credit',
  },
  {
    stage: 'Act',
    title: 'The next step, without losing the thread.',
    text: 'Follow up with the order number and the original promise. Keep every reply and every action in the same story.',
    note: 'Follow-up recorded · Waiting on the retailer',
  },
  {
    stage: 'Verify',
    title: 'A reply isn’t a resolution.',
    text: '“We’ve processed it” is progress. The money appearing in your account is proof. Check the condition that was set at the start.',
    note: 'Evidence → £128 credit on your bank statement',
  },
  {
    stage: 'Close',
    title: 'Now it’s finished.',
    text: 'The outcome happened. The evidence is there. The circle closes, and you get a little space back.',
    note: 'Outcome verified · Loop closed',
  },
];
export function Story() {
  return (
    <section id="how-it-works" className="story-section">
      <div className="story-heading">
        <span className="eyebrow">From loose end to full circle</span>
        <h2>
          There’s a difference between
          <br />
          doing something. <em>And finishing it.</em>
        </h2>
      </div>
      <div className="story-layout">
        <div className="story-diagram" data-stage="0" aria-hidden="true">
          <span className="tiny-label">THE LIFE OF A LOOP</span>
          <svg viewBox="0 0 260 260">
            <circle className="story-circle-track" cx="130" cy="130" r="102" />
            <circle
              className="story-circle-progress"
              cx="130"
              cy="130"
              r="102"
            />
          </svg>
          <div className="story-center">
            <span className="story-open-label">
              £128
              <br />
              <small>still on your mind</small>
            </span>
            <span className="story-closed-label">
              £128
              <br />
              <small>back where it belongs</small>
            </span>
          </div>
          <span className="diagram-footer">A REFUND, SEEN THROUGH.</span>
        </div>
        <div className="story-steps">
          {steps.map((step, i) => (
            <article className="story-step" key={step.stage}>
              <span className="step-index">
                0{i + 1} / {step.stage}
              </span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              <div className="story-note">{step.note}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
