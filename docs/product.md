# loopend

**Until it’s done.**

Loopend remembers what hasn’t finished, takes the next step, and stays on it until it’s done. A Loop holds a real-world situation and its expected outcome: a refund arriving, a repair actually working, or an appointment confirmed.

The model is **Detect → Understand → Wait → Act → Verify → Close**. An email sent or a reply received is progress. Only a verified outcome is completion.

## Initial working product

One private personal workspace. Users manually create Loops, record context, expected dates, responsibility, next actions, and verification conditions. They update state, append activity, and explicitly verify an outcome with written evidence before closing. Closed Loops remain readable and immutable through application commands.

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

The landing page tells the intended completion-agent story. Its CTA enters the real manual workspace. No Gmail, calendar, browser ingestion, scheduled follow-up, autonomous action, or external verification is connected yet. The UI states this where relevant. Evidence in this foundation is user-attested text, not independently verified by an agent.

The visual system uses an incomplete rust-red circle, warm paper, Manrope for readable UI, and Newsreader for editorial emphasis. A closed circle and muted green indicate completion. Typography is self-hosted. Animation explains the same refund from scattered context to verified bank credit; all story text is server-rendered.
