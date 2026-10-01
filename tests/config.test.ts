jest.mock('dotenv', () => ({ __esModule: true, default: { config: jest.fn() } }));

const originalEnv = process.env;
const keys = ['INVITE_URLS', 'RESEND_API_KEY', 'ALERT_SENDER', 'ALERT_RECIPIENT',
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'POLL_INTERVAL_MS', 'POLL_JITTER_PERCENTAGE'];

function loadConfig(values: Record<string, string> = {}): typeof import('../src/config') {
  process.env = { ...originalEnv };
  keys.forEach(key => delete process.env[key]);
  Object.assign(process.env, { INVITE_URLS: 'https://testflight.apple.com/join/ABCDEFGH' }, values);
  jest.resetModules();
  return require('../src/config');
}

afterEach(() => {
  process.env = originalEnv;
  jest.restoreAllMocks();
});

describe('configuration', () => {
  const email = { RESEND_API_KEY: 'test_api_key', ALERT_SENDER: 'sender@example.com', ALERT_RECIPIENT: 'recipient@example.com' };
  const telegram = { TELEGRAM_BOT_TOKEN: 'test_bot_token', TELEGRAM_CHAT_ID: 'test_chat_id' };

  it.each([
    [{}, false, false], [email, true, false], [telegram, false, true], [{ ...email, ...telegram }, true, true],
  ])('supports each independent channel combination', (values, emailEnabled, telegramEnabled) => {
    const config = loadConfig(values as Record<string, string>);
    expect(config.EMAIL_ENABLED).toBe(emailEnabled);
    expect(config.TELEGRAM_ENABLED).toBe(telegramEnabled);
  });

  it('deduplicates and normalises multiple invitations', () => {
    const config = loadConfig({ INVITE_URLS: ' https://testflight.apple.com/join/ABCDEFGH/?source=test | https://testflight.apple.com/join/IJKLMNOP | https://testflight.apple.com/join/ABCDEFGH#fragment | ' });
    expect(config.INVITE_URLS).toEqual(['https://testflight.apple.com/join/ABCDEFGH', 'https://testflight.apple.com/join/IJKLMNOP']);
  });

  it.each(['', ' | ', 'http://testflight.apple.com/join/ABCDEFGH', 'https://example.com/join/ABCDEFGH',
    'https://testflight.apple.com.example.com/join/ABCDEFGH', 'https://user:password@testflight.apple.com/join/ABCDEFGH',
    'https://testflight.apple.com:8080/join/ABCDEFGH', 'https://testflight.apple.com/join/short',
    'https://testflight.apple.com/other/ABCDEFGH', 'not a URL'])('rejects invalid invitations without echoing the value', value => {
    expect(() => loadConfig({ INVITE_URLS: value })).toThrow(/INVITE_URLS/);
  });

  it('names missing email settings without exposing the configured credential', () => {
    expect(() => loadConfig({ RESEND_API_KEY: 'private-test-value' })).toThrow('Missing: ALERT_SENDER, ALERT_RECIPIENT');
  });

  it('rejects partial Telegram configuration', () => {
    expect(() => loadConfig({ TELEGRAM_CHAT_ID: 'test_chat_id' })).toThrow('Missing: TELEGRAM_BOT_TOKEN');
  });

  it('rejects an empty recipient list', () => {
    expect(() => loadConfig({ ...email, ALERT_RECIPIENT: ', , ' })).toThrow('ALERT_RECIPIENT');
  });

  it.each(['invalid', '123garbage', '0', '-1', 'Infinity', '1.5', '2147483648'])('applies the interval default for %s', value => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadConfig({ POLL_INTERVAL_MS: value }).POLL_INTERVAL_MS).toBe(60000);
    expect(warning).toHaveBeenCalledWith('Invalid POLL_INTERVAL_MS. Defaulting to 60000.');
  });

  it.each(['invalid', '-1', '101', 'Infinity'])('applies the jitter default for %s', value => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadConfig({ POLL_JITTER_PERCENTAGE: value }).POLL_JITTER_PERCENTAGE).toBe(10);
  });

  it('accepts valid timing settings including zero jitter', () => {
    const config = loadConfig({ POLL_INTERVAL_MS: '120000', POLL_JITTER_PERCENTAGE: '0' });
    expect(config.POLL_INTERVAL_MS).toBe(120000);
    expect(config.POLL_JITTER_PERCENTAGE).toBe(0);
  });
});
