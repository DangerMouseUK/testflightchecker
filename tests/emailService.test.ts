jest.mock('../src/config', () => require('./mocks/configMock'));
jest.mock('../src/logger', () => ({
  __esModule: true, default: { info: jest.fn(), warn: jest.fn() },
  sanitizeError: () => ({ name: 'Error', message: '[REDACTED]' }),
}));

import * as config from '../src/config';
import { sendSlotOpenEmail } from '../src/emailService';
import logger from '../src/logger';

const originalFetch = global.fetch;
let fetchMock: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  fetchMock = jest.fn();
  global.fetch = fetchMock;
  Object.assign(config, { EMAIL_ENABLED: true });
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it('uses the real Resend SDK with a bounded, mocked request', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'test_email_id' }) });
  await sendSlotOpenEmail('https://testflight.apple.com/join/ABCDEFGH', 'ABCDEFGH');
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.resend.com/emails');
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(options.body)).toMatchObject({ to: ['test@example.com'], from: 'test@example.com',
    text: 'A TestFlight slot just opened for ABCDEFGH.\n\nJoin here: https://testflight.apple.com/join/ABCDEFGH' });
  expect(JSON.stringify((logger.info as jest.Mock).mock.calls)).not.toContain('test@example.com');
});

it('skips disabled email without constructing a request', async () => {
  Object.assign(config, { EMAIL_ENABLED: false });
  await sendSlotOpenEmail('https://testflight.apple.com/join/ABCDEFGH', 'ABCDEFGH');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('retries three times with backoff without exposing provider payloads', async () => {
  jest.useFakeTimers();
  fetchMock.mockResolvedValue({ ok: false, text: async () => JSON.stringify({ name: 'validation_error', message: 'private@example.com' }) });
  const delivery = sendSlotOpenEmail('https://testflight.apple.com/join/ABCDEFGH', 'ABCDEFGH');
  const failure = expect(delivery).rejects.toThrow('Email delivery failed after three attempts.');
  await jest.runAllTimersAsync();
  await failure;
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain('private@example.com');
});
