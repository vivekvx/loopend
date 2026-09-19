// Historical data is quarantined, never claimed by the first person who signs up.
export const LEGACY_OWNER_ID = '00000000-0000-0000-0000-000000000000';

export function assertUserId(userId: string): void {
  if (!userId || userId === LEGACY_OWNER_ID)
    throw new Error('An authenticated user is required.');
}
