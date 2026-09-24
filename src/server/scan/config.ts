import { readIntegrations, type Environment } from '../config';
export function scanSetup(env: Environment = process.env) {
  const { gmail, ai } = readIntegrations(env);
  return {
    gmailReady: !!gmail,
    aiReady: !!ai,
    origin: gmail?.APP_URL,
    model: ai?.LOOP_SCAN_AI_MODEL ?? '',
    baseUrl: ai?.LOOP_SCAN_AI_BASE_URL ?? '',
  };
}
