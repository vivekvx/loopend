import 'server-only';
import { ScanError } from '../../../domain/scan';
import { scanSetup } from '../../scan/config';
import { gmailClient } from './client';
import { tokenVault } from '../crypto';

export function gmailRuntime() {
  const setup = scanSetup();
  if (!setup.gmailReady) throw new ScanError('SETUP');
  return {
    client: gmailClient({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri: `${setup.origin}/api/gmail/callback`,
    }),
    vault: tokenVault(process.env.SOURCE_TOKEN_ENCRYPTION_KEY!),
  };
}
