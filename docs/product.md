# loopend

**Until it’s done.**

Loopend remembers what hasn’t finished, takes the next step, and stays on it until it’s done. A Loop holds a real-world situation and its expected outcome: a refund arriving, a repair actually working, or an appointment confirmed.

The model is **Detect → Understand → Wait → Act → Verify → Close**. An email sent or a reply received is progress. Only a verified outcome is completion.

## Initial working product

Each account has its own private personal workspace. Users manually create Loops, record context, expected dates, responsibility, next actions, and verification conditions. They update state, append activity, and explicitly verify an outcome with written evidence before closing. Closed Loops remain readable and immutable through application commands.

The dashboard groups open Loops into **Needs you** (explicitly needs the user, or expected today/overdue) and **Being handled** (all other active Loops). Its calm headline reflects the real attention count. Recently closed shows the last three updated closed records; the closed page shows all. Expected dates are calendar dates, with the initial workspace using UTC for consistent day boundaries.

## States

| State         | Meaning                                                           |
| ------------- | ----------------------------------------------------------------- |
| OPEN          | A situation has been recognized and recorded.                     |
| WAITING       | Someone or something else is expected to act.                     |
| NEEDS_USER    | The user needs to decide, act, or supply information.             |
| AGENT_WORKING | Work is in progress; initially this is a manually recorded state. |
| VERIFYING     | The outcome appears to have happened and needs checking.          |
| CLOSED        | The user checked the condition and recorded evidence.             |

Active states may move between each other as the situation changes. CLOSED is excluded from the edit form and update schema. The completion command requires VERIFYING, substantive evidence, and explicit confirmation. There is no automatic close or reopen in this version.

## Product honesty

The landing page tells the intended completion-agent story. Its CTA leads to account creation (or the dashboard for an authenticated user). Loop Scan connects Gmail and suggests unfinished situations for review. Gmail-originated Loops can be monitored: Loopend wakes at a conservative scheduled time, reads only their linked conversation, and records an observation. It can move a likely completed outcome to VERIFYING, or ask for help when the evidence is unclear. It never sends email, performs browser actions, buys anything, or closes a Loop. Evidence for closing a Loop is still user-attested text, not independently verified by an agent.

The visual system uses an incomplete rust-red circle, warm paper, Manrope for readable UI, and Newsreader for editorial emphasis. A closed circle and muted green indicate completion. Typography is self-hosted. Animation explains the same refund from scattered context to verified bank credit; all story text is server-rendered.

## Loop Scan

**Find what you’ve forgotten.** Connect Gmail with read-only permission, then explicitly scan up to 50 messages from the last 30 days. Connecting does not start a scan. Loopend cannot send, delete, or modify mail. Missing Gmail or AI configuration displays a setup state; manual Loops keep working.

Gmail → External Event → Detector → Candidate → Human approval → Loop

Suggestions focus on concrete pending outcomes: promised refunds, documents, support responses, repairs, application decisions, and appointment confirmations. Newsletters, ordinary receipts, completed transactions, marketing, and vague conversation are excluded. Low-confidence output is discarded. Review shows the situation, outcome, waiting-on party, grounded date when available, suggested next action, verification condition, reason, and inspectable source excerpts. Confidence appears as “Clear commitment” or “Worth a look,” never a percentage.

“Track this” creates an OPEN Loop with Gmail/Loop Scan provenance in its activity timeline. Repeated or concurrent approval returns the same Loop. “Ignore” permanently suppresses that conversation for the connected account, including after reconnecting. This first version allows one candidate per conversation; MERGED is reserved for a future explicit merge flow. There is no automatic promotion, completion, or follow-up.

A later successful scan may refresh or withdraw an unreviewed suggestion when its evidence changes. Explicit human decisions always win. Scans never update existing real Loops. Pending suggestions outside the bounded window are not re-evaluated. The scan is not a complete mailbox audit: earlier or omitted replies may change the interpretation. Review the evidence before tracking. Dates come from explicit dates or numeric day windows; vague dates remain unset. Business-day windows exclude weekends, not holidays.

## Monitoring

Gmail Loops accepted from Loop Scan retain their source conversation. From the Loop detail page, choose **Enable monitoring**, a cadence of one day, three days, or a week, and an optional first check. An expected date pushes the first automatic check until after that window. Monitoring is **OBSERVE_ONLY**: it reads the one linked Gmail conversation and never sends or modifies mail.

Loopend records a short observation in the immutable timeline. No new evidence leaves the Loop in WAITING and schedules a later check. Plausible evidence of the outcome moves it to VERIFYING with an inspectable excerpt; only the user can then verify and close it. A disconnected account, ambiguous evidence, or repeated safe failures moves it to NEEDS_USER. Pausing monitoring cancels its future wake-up. Background checks are conservative and do not scan the mailbox.

### Privacy and disconnect

The detector receives shortened text, sender, subject, timestamp, direction, grounded date options, and opaque source references. Quoted history, common signatures, tracking URLs, and HTML are stripped where practical. Attachments are not stored or sent to the detector. Normalization is best-effort, not a guarantee that all personal information is removed.

Loopend stores the connected account identity, encrypted Google tokens, message/thread identifiers, timestamps, and candidate decisions. Cited evidence retains normalized excerpts (up to 2,000 characters per message), sender, subject, and date metadata. Uncited events retain only trace/dedupe identifiers, timestamps, and direction. Saved suggestions and evidence remain until an operator removes them; there is no automatic retention expiry or erase-all UI yet.

Disconnect immediately removes local tokens, stops new scans, invalidates in-flight scan writes, and attempts Google revocation. If revocation fails, the UI directs the user to Google account permissions. Suggestions, cited excerpts, ignored-conversation dedupe records, and real Loops remain. Reconnecting the same account preserves decisions. Review the configured AI provider’s data handling before scanning sensitive mail.

## Accounts and ownership

Email/password accounts provide sign-up, sign-in, persistent sessions, and sign-out. Settings shows account identity, Gmail connection status, disconnect controls, and sign-out. Signing out invalidates that session; other devices keep their own sessions. Marketing remains public. Every application surface and command is authenticated, including direct links and form submissions.

Loops, history, connections, scan state, candidates, and source evidence are isolated by user. A Gmail account is reserved to one Loopend account, including after disconnect, so another user cannot take over saved evidence or ignored-conversation decisions. Gmail authorization is separate from signing into Loopend and must begin and finish in the same authenticated session.

Existing pre-account data is preserved in quarantine, invisible to new accounts. An operator may explicitly transfer it to a named existing user after reviewing ownership. Signup never claims old data. Local seeds require a chosen account ID.

Email addresses are login identifiers, not verified proof of mailbox ownership. This release does not include email verification, password reset email, social sign-in, account deletion, or cross-account transfer UI. No buttons pretend those capabilities exist. Gmail access always requires Google's separate authorization flow.
