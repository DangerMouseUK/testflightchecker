import http from 'http';
import { checkUrlAndNotifyOnChange, cleanupPreviousSlotStatus } from './worker';
import { INVITE_URLS, POLL_INTERVAL_MS, POLL_JITTER_PERCENTAGE, EMAIL_ENABLED, TELEGRAM_ENABLED } from './config';
import { sendTelegramMessage } from './telegramService';
import logger, { sanitizeError } from './logger';

const serviceStartTime = Date.now();
let lastSuccessfulPollCycleTimestamp: string | null = null;
const PORT = Number(process.env.PORT || 8080);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be between 1 and 65535.');

async function runPolling(): Promise<void> {
  let allSuccessful = true;
  for (const url of INVITE_URLS) {
    try {
      const result = await checkUrlAndNotifyOnChange(url);
      if (result.isFull === null) allSuccessful = false;
    } catch (error) {
      allSuccessful = false;
      logger.error({ err: sanitizeError(error) }, 'Failed to process invitation');
    }
  }
  if (allSuccessful) lastSuccessfulPollCycleTimestamp = new Date().toISOString();
  logger.info({ allSuccessful }, 'Polling cycle finished');
}

function scheduleNextPoll(): void {
  const maxJitter = POLL_INTERVAL_MS * POLL_JITTER_PERCENTAGE / 100;
  const delay = Math.min(2147483647, Math.max(1000, POLL_INTERVAL_MS * 0.5,
    POLL_INTERVAL_MS + (Math.random() * 2 - 1) * maxJitter));
  setTimeout(() => {
    runPolling().catch(error => {
      logger.error({ err: sanitizeError(error) }, 'Polling cycle failed');
    }).finally(scheduleNextPoll);
  }, delay);
}

async function main(): Promise<void> {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/healthz') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const memory = process.memoryUsage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      serviceUptimeSeconds: Math.floor((Date.now() - serviceStartTime) / 1000),
      numberOfMonitoredUrls: INVITE_URLS.length,
      lastSuccessfulPollCycleTimestamp,
      memory: {
        rss: Math.round(memory.rss / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
        external: Math.round(memory.external / 1024 / 1024),
      },
    }));
  });
  server.on('error', error => {
    logger.error({ err: sanitizeError(error) }, 'Health server failed');
    process.exit(1);
  });
  server.listen(PORT, () => logger.info({ port: PORT }, 'Health server listening'));
  logger.info({ monitoredUrls: INVITE_URLS.length, EMAIL_ENABLED, TELEGRAM_ENABLED,
    pollIntervalMs: POLL_INTERVAL_MS, jitterPercentage: POLL_JITTER_PERCENTAGE }, 'testflightchecker started');

  if (TELEGRAM_ENABLED) {
    try {
      await sendTelegramMessage('testflightchecker initialised successfully.');
    } catch (error) {
      logger.warn({ err: sanitizeError(error) }, 'Telegram startup notification failed');
    }
  }
  cleanupPreviousSlotStatus();
  setInterval(cleanupPreviousSlotStatus, 60 * 60 * 1000);
  await runPolling();
  scheduleNextPoll();
}

main().catch(error => {
  logger.error({ err: sanitizeError(error) }, 'testflightchecker failed');
  process.exit(1);
});
