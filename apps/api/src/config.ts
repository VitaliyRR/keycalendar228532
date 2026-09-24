import 'dotenv/config';
import {z} from 'zod';

const schema=z.object({
  NODE_ENV:z.enum(['development','test','production']).default('development'),
  HOST:z.string().default('127.0.0.1'),
  PORT:z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL:z.string().url(),
  DATABASE_MIGRATE_URL:z.string().url().optional(),
  DATABASE_APP_PASSWORD:z.string().min(16).optional(),
  WEB_ORIGIN:z.string().url().default('http://127.0.0.1:5173'),
  SESSION_COOKIE_SECURE:z.enum(['true','false']).default('false'),
  CSRF_SECRET:z.string().min(32),
  EMAIL_DELIVERY:z.enum(['development','smtp','disabled']).default('disabled'),
  SMTP_URL:z.string().url().optional(),
  MAIL_FROM:z.string().email().optional(),
  CONNECTION_SECRET_KEY:z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  WEB_DIST_DIR:z.string().optional(),
  TLS_KEY_PATH:z.string().optional(),
  TLS_CERT_PATH:z.string().optional(),
});
export type Config=z.infer<typeof schema>;
export function loadConfig():Config {
  const config=schema.parse(process.env);
  if(config.NODE_ENV==='production') {
    if(config.SESSION_COOKIE_SECURE!=='true') throw new Error('Secure session cookie required in production');
    if(config.EMAIL_DELIVERY==='development') throw new Error('Development email delivery forbidden in production');
    if(!config.WEB_ORIGIN.startsWith('https://')) throw new Error('HTTPS WEB_ORIGIN required in production');
  }
  if(Boolean(config.TLS_KEY_PATH)!==Boolean(config.TLS_CERT_PATH))throw new Error('TLS_KEY_PATH and TLS_CERT_PATH must be configured together');
  if(config.EMAIL_DELIVERY==='development' && !['127.0.0.1','localhost','::1'].includes(config.HOST)) throw new Error('Development verification requires loopback host');
  if(config.EMAIL_DELIVERY==='smtp' && (!config.SMTP_URL||!config.MAIL_FROM)) throw new Error('SMTP_URL and MAIL_FROM required');
  return config;
}
