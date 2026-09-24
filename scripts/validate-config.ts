import { readConfig, ConfigurationError } from '../src/server/config';
import { operationalLog } from '../src/server/logging';
try {
  const role = process.argv[2] ?? 'web';
  if (role !== 'web' && role !== 'worker')
    throw new ConfigurationError(['PROCESS_ROLE']);
  readConfig(role);
  operationalLog({ event: 'config.ready' });
} catch (error) {
  operationalLog({ event: 'config.failed', code: 'CONFIG' });
  if (error instanceof ConfigurationError) console.error(error.message);
  process.exitCode = 1;
}
