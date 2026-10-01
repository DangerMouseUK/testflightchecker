import { sanitizeError } from '../src/logger';

it('redacts private values, request URLs, addresses, and filesystem paths', () => {
  const original = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_CHAT_ID = 'fictional-chat-id';
  try {
    const credential = 're_' + 'test-private-value-123456';
    const error = new Error(`Failed for recipient@example.com, fictional-chat-id, ${credential}, https://example.com/private and C:/Users/example/private.txt`);
    const output = JSON.stringify(sanitizeError(error));
    for (const value of ['recipient@example.com', 'fictional-chat-id', credential, 'https://example.com/private', 'C:/Users/example']) {
      expect(output).not.toContain(value);
    }
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('stack');
  } finally {
    if (original === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = original;
  }
});

it('does not expose arbitrary non-Error payloads or an unsafe error name', () => {
  expect(sanitizeError({ token: 'private' })).toEqual({ name: 'Error', message: 'Operation failed' });
  const error = new Error('Operation failed');
  error.name = 'private@example.com';
  expect(sanitizeError(error).name).toBe('Error');
});
