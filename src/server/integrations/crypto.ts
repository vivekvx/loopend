import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ScanError } from '../../domain/scan';

export function tokenVault(encodedKey: string) {
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) throw new ScanError('SETUP');
  return {
    seal(value: unknown, purpose: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(purpose));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final(),
      ]);
      return [
        'v1',
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        ciphertext.toString('base64url'),
      ].join('.');
    },
    open(value: string, purpose: string): unknown {
      try {
        const [version, iv, tag, ciphertext] = value.split('.');
        if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error();
        const decipher = createDecipheriv(
          'aes-256-gcm',
          key,
          Buffer.from(iv, 'base64url'),
        );
        decipher.setAAD(Buffer.from(purpose));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(ciphertext, 'base64url')),
            decipher.final(),
          ]).toString('utf8'),
        ) as unknown;
      } catch {
        throw new ScanError('GMAIL_AUTH');
      }
    },
  };
}
