import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function optionalValue(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export const ALERT_SENDER = optionalValue('ALERT_SENDER');
export const ALERT_RECIPIENT = optionalValue('ALERT_RECIPIENT');
export const RESEND_API_KEY = optionalValue('RESEND_API_KEY');
export const TELEGRAM_BOT_TOKEN = optionalValue('TELEGRAM_BOT_TOKEN');
export const TELEGRAM_CHAT_ID = optionalValue('TELEGRAM_CHAT_ID');

function channelEnabled(channel: string, fields: Record<string, string | undefined>): boolean {
  const entries = Object.entries(fields);
  if (entries.every(([, value]) => !value)) return false;
  const missing = entries.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Incomplete ${channel} configuration. Missing: ${missing.join(', ')}`);
  }
  return true;
}

export const EMAIL_ENABLED = channelEnabled('email', { RESEND_API_KEY, ALERT_SENDER, ALERT_RECIPIENT });
export const TELEGRAM_ENABLED = channelEnabled('Telegram', { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID });

if (EMAIL_ENABLED && !ALERT_RECIPIENT!.split(',').some(value => value.trim())) {
  throw new Error('ALERT_RECIPIENT must contain at least one recipient.');
}

const inviteUrlsRaw = optionalValue('INVITE_URLS');
if (!inviteUrlsRaw) throw new Error('Missing required environment variable: INVITE_URLS');

export const INVITE_URLS = [...new Set(inviteUrlsRaw.split('|').map(value => {
  const raw = value.trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'testflight.apple.com' ||
        url.port || url.username || url.password || !/^\/join\/[A-Za-z0-9]{8}\/?$/.test(url.pathname)) {
      throw new Error('Invalid invitation');
    }
    return `https://testflight.apple.com${url.pathname.replace(/\/$/, '')}`;
  } catch {
    throw new Error('INVITE_URLS must contain public https://testflight.apple.com/join/<code> links.');
  }
}).filter(Boolean))];

if (!INVITE_URLS.length) throw new Error('INVITE_URLS cannot be empty after parsing.');

function pollingSetting(name: string, fallback: number, valid: (value: number) => boolean): number {
  const raw = optionalValue(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (Number.isFinite(value) && valid(value)) return value;
  console.warn(`Invalid ${name}. Defaulting to ${fallback}.`);
  return fallback;
}

export const POLL_INTERVAL_MS = pollingSetting('POLL_INTERVAL_MS', 60000,
  value => Number.isInteger(value) && value > 0 && value <= 2147483647);
export const POLL_JITTER_PERCENTAGE = pollingSetting('POLL_JITTER_PERCENTAGE', 10,
  value => value >= 0 && value <= 100);
export const REQUEST_TIMEOUT_MS = 15000;
