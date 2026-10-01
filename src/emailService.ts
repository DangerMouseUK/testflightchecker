import { Resend, CreateEmailRequestOptions } from 'resend';
import * as config from './config';
import logger, { sanitizeError } from './logger';

const MAX_RETRIES = 2;
let resend: Resend | undefined;

export async function sendSlotOpenEmail(inviteUrl: string, appName: string): Promise<void> {
  if (!config.EMAIL_ENABLED) return;
  resend ??= new Resend(config.RESEND_API_KEY!);
  const recipients = config.ALERT_RECIPIENT!.split(',').map(value => value.trim()).filter(Boolean);
  const payload = {
    from: config.ALERT_SENDER!,
    to: recipients,
    subject: `TestFlight slot open for ${appName}`,
    text: `A TestFlight slot just opened for ${appName}.\n\nJoin here: ${inviteUrl}`,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // The SDK forwards request options to fetch, including the abort signal.
      const options: CreateEmailRequestOptions & { signal: AbortSignal } = {
        signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
      };
      const { error } = await resend.emails.send(payload, options);
      if (error) throw new Error('Resend rejected the email request.');
      logger.info({ attempt: attempt + 1, recipientCount: recipients.length }, 'Email notification sent');
      return;
    } catch (error) {
      logger.warn({ attempt: attempt + 1, err: sanitizeError(error) }, 'Email delivery failed');
      if (attempt === MAX_RETRIES) throw new Error('Email delivery failed after three attempts.');
    }
    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(4, attempt)));
  }
}
