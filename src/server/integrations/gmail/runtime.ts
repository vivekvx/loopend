import 'server-only';
import { ScanError } from '../../../domain/scan';
import { readIntegrations } from '../../config';
import { gmailClient } from './client';
import { tokenVault } from '../crypto';

export function gmailRuntime() {
  const { gmail } = readIntegrations();
  if (!gmail) throw new ScanError('SETUP');
  return {
    client: gmailClient({
      clientId: gmail.GOOGLE_CLIENT_ID,
      clientSecret: gmail.GOOGLE_CLIENT_SECRET,
      redirectUri: `${gmail.APP_URL}/api/gmail/callback`,
    }),
    vault: tokenVault(gmail.SOURCE_TOKEN_ENCRYPTION_KEY),
  };
}
