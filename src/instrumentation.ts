import type { Instrumentation } from 'next';
export const onRequestError: Instrumentation.onRequestError = async () => {
  const { operationalLog } = await import('./server/logging');
  operationalLog({ event: 'web.failed', code: 'STORAGE' });
};
