import { fetch } from 'undici';
import * as config from './config';
import logger from './logger';

export async function sendTelegramMessage(message: string): Promise<void> {
  if (!config.TELEGRAM_ENABLED) return;
  try {
    const response = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, text: message }),
      signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Telegram request failed.');
    }
    const result = await response.json() as { ok?: boolean };
    if (result.ok !== true) throw new Error('Telegram rejected the message.');
    logger.info('Telegram notification sent');
  } catch {
    // Telegram's request URL contains the token; never propagate raw client errors.
    throw new Error('Telegram notification failed.');
  }
}
