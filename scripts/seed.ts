import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import * as schema from '../src/server/db/schema';
import { loopService } from '../src/server/loops/service';

if (process.env.NODE_ENV === 'production')
  throw new Error('Development seeds cannot run in production.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });
const userId = process.argv[2];
if (!userId)
  throw new Error('Create an account, then run pnpm db:seed <user-id>.');
const service = loopService(db, userId);
const future = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const seeds = [
  {
    title: 'The refund from Arket',
    summary:
      'The linen jacket was returned. The return has been received, but the refund is still on its way.',
    desiredOutcome: '£128 returned to my original payment method.',
    status: 'WAITING',
    waitingOn: 'Arket customer care',
    expectedBy: future(3),
    nextAction:
      'Check the bank statement on the expected date. Follow up if the credit is missing.',
    verificationCondition: 'A £128 credit is visible in my bank account.',
    note: 'Return received by Arket. Refund expected within 3–5 business days.',
  },
  {
    title: 'Kitchen tap, finally fixed',
    summary:
      'The tap has been dripping since last week. The landlord has contacted a plumber.',
    desiredOutcome: 'The kitchen tap works without leaking.',
    status: 'WAITING',
    waitingOn: 'Sam, the property manager',
    expectedBy: future(5),
    nextAction: 'Get a confirmed time for the plumber’s visit.',
    verificationCondition:
      'Run the tap and check that it stays dry after switching it off.',
    note: 'Sam confirmed the repair request is with the plumber.',
  },
  {
    title: 'A date for the dental check-up',
    summary: 'Requested a morning appointment for next month.',
    desiredOutcome: 'A suitable appointment is confirmed in writing.',
    status: 'OPEN',
    waitingOn: 'The dental practice',
    expectedBy: future(7),
    nextAction: 'Wait for available morning slots.',
    verificationCondition:
      'The practice sends written confirmation of the agreed date and time.',
    note: 'Appointment request sent through the practice’s website.',
  },
  {
    title: 'The document for my application',
    summary:
      'The application needs a signed employment letter from the HR team.',
    desiredOutcome: 'A signed employment letter is attached to my application.',
    status: 'VERIFYING',
    waitingOn: 'Me, to check the document',
    expectedBy: future(2),
    nextAction:
      'Check the name, employment dates, and signature before uploading.',
    verificationCondition:
      'The correct signed PDF is accepted by the application portal.',
    note: 'HR sent the signed letter. Ready to check and upload.',
  },
  {
    title: 'The book that found its way back',
    summary: 'A replacement was requested after the original parcel was lost.',
    desiredOutcome: 'The replacement book arrived in good condition.',
    status: 'VERIFYING',
    waitingOn: '',
    expectedBy: '',
    nextAction: 'Check the replacement package.',
    verificationCondition: 'The correct book is delivered and undamaged.',
    note: 'The replacement arrived this morning.',
    closed: true,
  },
] as const;
try {
  const [owner] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  if (!owner) throw new Error('Seed owner must be an existing account.');
  for (const seed of seeds) {
    const existing = await db
      .select({ id: schema.loops.id })
      .from(schema.loops)
      .where(
        and(
          eq(schema.loops.userId, userId),
          eq(schema.loops.title, seed.title),
        ),
      )
      .limit(1);
    if (existing.length) continue;
    const loop = await service.create(seed);
    await service.addActivity(loop.id, 1, seed.note);
    if ('closed' in seed)
      await service.complete(loop.id, 2, {
        evidence:
          'Opened the delivered package and checked the title, cover, and pages. All correct and undamaged.',
        confirmed: true,
      });
  }
  console.log('Development Loops seeded. Existing examples were preserved.');
} finally {
  await client.end();
}
