import pino from 'pino';

export function sanitizeError(error: unknown): { name: string; message: string } {
  const allowedNames = ['Error', 'TypeError', 'TimeoutError', 'AbortError', 'SyntaxError'];
  const name = error instanceof Error && allowedNames.includes(error.name) ? error.name : 'Error';
  let message = error instanceof Error ? error.message : 'Operation failed';
  for (const key of ['RESEND_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'ALERT_SENDER', 'ALERT_RECIPIENT']) {
    const value = process.env[key]?.trim();
    if (value) message = message.split(value).join('[REDACTED]');
  }
  message = message
    .replace(/re_[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/\d{6,}:[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED]')
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[REDACTED]')
    .replace(/https?:\/\/\S+/g, '[REDACTED_URL]')
    .replace(/(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]|\/(?:Users|home)\/)[^\s]+/g, '[REDACTED_PATH]');
  return { name, message };
}

const logger = pino({
  base: undefined,
  redact: {
    paths: ['recipients', 'recipient', 'chatId', 'token', 'apiKey', 'RESEND_API_KEY',
      'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'ALERT_SENDER', 'ALERT_RECIPIENT',
      'headers.authorization', 'req.headers.authorization'],
    remove: true,
  },
  ...(process.env.NODE_ENV !== 'production' && process.stdout.isTTY ? {
    transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } },
  } : {}),
});

export default logger;
