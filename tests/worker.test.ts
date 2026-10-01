import fs from 'fs';
import path from 'path';

jest.mock('../src/config', () => require('./mocks/configMock'));
jest.mock('undici', () => ({ fetch: jest.fn() }));
jest.mock('../src/emailService', () => ({ sendSlotOpenEmail: jest.fn() }));
jest.mock('../src/telegramService', () => ({ sendTelegramMessage: jest.fn() }));
jest.mock('../src/logger', () => ({
  __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  sanitizeError: () => ({ name: 'Error', message: '[REDACTED]' }),
}));

import { fetch } from 'undici';
import * as config from '../src/config';
import * as email from '../src/emailService';
import * as telegram from '../src/telegramService';
import { parseBetaStatus, pollUrl, checkUrlAndNotifyOnChange, cleanupPreviousSlotStatus } from '../src/worker';

const fullHtml = fs.readFileSync(path.join(__dirname, 'fixtures/beta_full.html'), 'utf8');
const openHtml = fs.readFileSync(path.join(__dirname, 'fixtures/beta_open.html'), 'utf8');
const closedHtml = fs.readFileSync(path.join(__dirname, 'fixtures/beta_not_accepting.html'), 'utf8');
const fetchMock = fetch as jest.Mock;
const emailMock = email.sendSlotOpenEmail as jest.Mock;
const telegramMock = telegram.sendTelegramMessage as jest.Mock;
const firstUrl = 'https://testflight.apple.com/join/ABCDEFGH';
const secondUrl = 'https://testflight.apple.com/join/IJKLMNOP';

function page(html: string): void {
  fetchMock.mockResolvedValueOnce({ ok: true, text: async () => html });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(config, { EMAIL_ENABLED: true, TELEGRAM_ENABLED: true, INVITE_URLS: [] });
  cleanupPreviousSlotStatus();
  Object.assign(config, { INVITE_URLS: [firstUrl, secondUrl] });
  emailMock.mockResolvedValue(undefined);
  telegramMock.mockResolvedValue(undefined);
});

describe('HTML parsing', () => {
  it.each([[fullHtml, true], [closedHtml, true], [openHtml, false]])('recognises known TestFlight states', (html, expected) => {
    expect(parseBetaStatus(html as string)).toBe(expected);
  });
  it.each(['', '<html><h1>Temporarily unavailable</h1></html>', '<div class="beta-status"><span>Unexpected status</span></div>',
    '<div class="beta-status"></div>', '<a href="https://example.com">View in TestFlight</a>'])('keeps unfamiliar pages unknown', html => {
    expect(parseBetaStatus(html)).toBeNull();
  });
  it('recognises the joining instructions without a join control', () => {
    expect(parseBetaStatus(openHtml.replace(/<a.*?<\/a>/, ''))).toBe(false);
  });
  it('recognises a valid join control without the instructions', () => {
    expect(parseBetaStatus('<a href="itms-beta://testflight.apple.com/join/ABCDEFGH">View in TestFlight</a>')).toBe(false);
  });
  it('gives closed status priority over an apparent join control', () => {
    expect(parseBetaStatus(fullHtml + '<a href="itms-beta://testflight.apple.com/join/ABCDEFGH">View in TestFlight</a>')).toBe(true);
  });
});

describe('polling', () => {
  it('bounds requests and returns a timestamped status', async () => {
    page(openHtml);
    const result = await pollUrl(firstUrl);
    expect(result).toMatchObject({ url: firstUrl, isFull: false });
    expect(Date.parse(result.timestamp)).not.toBeNaN();
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
  });
  it('treats HTTP errors as unknown and closes the response body', async () => {
    const cancel = jest.fn();
    fetchMock.mockResolvedValue({ ok: false, status: 429, body: { cancel } });
    expect((await pollUrl(firstUrl)).isFull).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });
  it.each([new Error('Network failure'), Object.assign(new Error('Timed out'), { name: 'TimeoutError' })])('keeps request failures unknown', async error => {
    fetchMock.mockRejectedValueOnce(error);
    expect((await pollUrl(firstUrl)).isFull).toBeNull();
  });
});

describe('state transitions and notifications', () => {
  it.each([[true, false], [false, true], [true, true], [false, false]])('supports email=%s Telegram=%s', async (emailEnabled, telegramEnabled) => {
    Object.assign(config, { EMAIL_ENABLED: emailEnabled, TELEGRAM_ENABLED: telegramEnabled });
    page(fullHtml);
    await checkUrlAndNotifyOnChange(firstUrl);
    expect(emailMock).not.toHaveBeenCalled();
    expect(telegramMock).not.toHaveBeenCalled();
    page(openHtml);
    await checkUrlAndNotifyOnChange(firstUrl);
    expect(emailMock).toHaveBeenCalledTimes(emailEnabled ? 1 : 0);
    expect(telegramMock).toHaveBeenCalledTimes(telegramEnabled ? 1 : 0);
    page(openHtml);
    await checkUrlAndNotifyOnChange(firstUrl);
    expect(emailMock).toHaveBeenCalledTimes(emailEnabled ? 1 : 0);
  });
  it('does not alert when the initial check is already open', async () => {
    page(openHtml);
    await checkUrlAndNotifyOnChange(firstUrl);
    expect(emailMock).not.toHaveBeenCalled();
    expect(telegramMock).not.toHaveBeenCalled();
  });
  it('preserves a full baseline through unknown HTML and network failures', async () => {
    page(fullHtml);
    await checkUrlAndNotifyOnChange(firstUrl);
    page('<h1>Upstream unavailable</h1>');
    await checkUrlAndNotifyOnChange(firstUrl);
    fetchMock.mockRejectedValueOnce(new Error('Network failure'));
    await checkUrlAndNotifyOnChange(firstUrl);
    expect(emailMock).not.toHaveBeenCalled();
    page(openHtml);
    await checkUrlAndNotifyOnChange(firstUrl);
    expect(emailMock).toHaveBeenCalledTimes(1);
  });
  it('tracks multiple invitations independently', async () => {
    page(fullHtml);
    await checkUrlAndNotifyOnChange(firstUrl);
    page(openHtml);
    await checkUrlAndNotifyOnChange(secondUrl);
    page(openHtml);
    await checkUrlAndNotifyOnChange(firstUrl);
    expect(emailMock).toHaveBeenCalledWith(firstUrl, 'ABCDEFGH');
    expect(emailMock).toHaveBeenCalledTimes(1);
  });
  it.each(['email', 'Telegram'])('delivers to the other channel when %s fails', async channel => {
    page(fullHtml);
    await checkUrlAndNotifyOnChange(firstUrl);
    (channel === 'email' ? emailMock : telegramMock).mockRejectedValueOnce(new Error('Delivery failure'));
    page(openHtml);
    await checkUrlAndNotifyOnChange(firstUrl);
    expect(emailMock).toHaveBeenCalledTimes(1);
    expect(telegramMock).toHaveBeenCalledTimes(1);
    expect(telegramMock.mock.calls[0][0]).toContain('\n\nInvite link:');
  });
  it('sends closed updates through Telegram only', async () => {
    page(openHtml);
    await checkUrlAndNotifyOnChange(firstUrl);
    page(closedHtml);
    await checkUrlAndNotifyOnChange(firstUrl);
    expect(emailMock).not.toHaveBeenCalled();
    expect(telegramMock).toHaveBeenCalledTimes(1);
  });
});
