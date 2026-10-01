import { fetch } from 'undici';
import * as cheerio from 'cheerio';
import * as emailService from './emailService';
import * as telegramService from './telegramService';
import * as config from './config';
import logger, { sanitizeError } from './logger';

const previousSlotStatus = new Map<string, boolean>();

export interface PollResult {
  url: string;
  isFull: boolean | null;
  timestamp: string;
}

export function parseBetaStatus(html: string): boolean | null {
  const $ = cheerio.load(html);
  const statuses = $('div.beta-status span').map((_, element) =>
    $(element).text().replace(/\s+/g, ' ').trim()).get();
  if (statuses.some(text => text === 'This beta is full.' ||
      text === "This beta isn't accepting any new testers right now.")) return true;
  if (statuses.some(text => /^To join the .+ beta, open the link on .+ after you install TestFlight\.$/.test(text))) {
    return false;
  }
  const hasJoinControl = $('a[href]').toArray().some(element =>
    /^itms-beta:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]{8}\/?$/.test($(element).attr('href') || '') &&
    $(element).text().trim() === 'View in TestFlight');
  return hasJoinControl ? false : null;
}

export async function pollUrl(url: string): Promise<PollResult> {
  const timestamp = new Date().toISOString();
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'testflightchecker/1.0' },
      signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      logger.warn({ status: response.status }, 'TestFlight request failed');
      return { url, isFull: null, timestamp };
    }
    return { url, isFull: parseBetaStatus(await response.text()), timestamp };
  } catch (error) {
    logger.warn({ err: sanitizeError(error) }, 'TestFlight request failed');
    return { url, isFull: null, timestamp };
  }
}

export function cleanupPreviousSlotStatus(): void {
  const activeUrls = new Set(config.INVITE_URLS);
  for (const url of previousSlotStatus.keys()) {
    if (!activeUrls.has(url)) previousSlotStatus.delete(url);
  }
}

export async function checkUrlAndNotifyOnChange(url: string): Promise<PollResult> {
  const result = await pollUrl(url);
  const { isFull } = result;
  const inviteCode = new URL(url).pathname.split('/').pop();
  if (isFull === null) {
    logger.warn({ inviteCode }, 'Availability unknown; preserving previous status');
    return result;
  }

  const previouslyFull = previousSlotStatus.get(url);
  logger.info({ inviteCode, isFull, previouslyFull }, 'TestFlight status check');
  const notifications: { channel: string; send: () => Promise<void> }[] = [];
  if (previouslyFull === true && !isFull) {
    const appName = inviteCode || 'TestFlight beta';
    logger.info({ inviteCode }, 'TestFlight slot opened');
    if (config.EMAIL_ENABLED) notifications.push({ channel: 'email', send: () => emailService.sendSlotOpenEmail(url, appName) });
    if (config.TELEGRAM_ENABLED) notifications.push({ channel: 'Telegram', send: () =>
      telegramService.sendTelegramMessage(`A TestFlight slot opened for ${appName}!\n\nInvite link: ${url}`) });
  } else if (previouslyFull === false && isFull && config.TELEGRAM_ENABLED) {
    notifications.push({ channel: 'Telegram', send: () =>
      telegramService.sendTelegramMessage(`The TestFlight beta (${inviteCode}) is now closed or full.\n\nInvite link: ${url}`) });
  }

  await Promise.all(notifications.map(async notification => {
    try {
      await notification.send();
    } catch (error) {
      logger.error({ channel: notification.channel, err: sanitizeError(error) }, 'Notification delivery failed');
    }
  }));
  previousSlotStatus.set(url, isFull);
  return result;
}
