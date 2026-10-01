jest.mock('../src/config', () => require('./mocks/configMock'));
jest.mock('undici', () => ({ fetch: jest.fn() }));
jest.mock('../src/logger', () => ({ __esModule: true, default: { info: jest.fn() } }));

import { fetch } from 'undici';
import * as config from '../src/config';
import { sendTelegramMessage } from '../src/telegramService';

const fetchMock = fetch as jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(config, { TELEGRAM_ENABLED: true });
});

it('sends plain text with a bounded request', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  await sendTelegramMessage('A slot opened!\n\nJoin the beta.');
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.telegram.org/bottest_bot_token/sendMessage');
  expect(options.method).toBe('POST');
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(options.body)).toEqual({ chat_id: 'test_chat_id', text: 'A slot opened!\n\nJoin the beta.' });
});

it('skips disabled Telegram without a request', async () => {
  Object.assign(config, { TELEGRAM_ENABLED: false });
  await sendTelegramMessage('test');
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  { ok: false, body: { cancel: jest.fn() } },
  { ok: true, json: async () => ({ ok: false, description: 'private provider details' }) },
  { ok: true, json: async () => { throw new Error('private response'); } },
])('returns a safe error for provider failures', async response => {
  fetchMock.mockResolvedValue(response);
  await expect(sendTelegramMessage('test')).rejects.toThrow('Telegram notification failed.');
});

it('never propagates a raw request URL or token', async () => {
  fetchMock.mockRejectedValue(new Error('Request failed: https://api.telegram.org/bottest_bot_token/sendMessage'));
  await expect(sendTelegramMessage('test')).rejects.toThrow(/^Telegram notification failed\.$/);
});
