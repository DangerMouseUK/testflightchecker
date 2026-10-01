jest.mock('../src/config', () => require('./mocks/configMock'));
jest.mock('../src/worker', () => ({ checkUrlAndNotifyOnChange: jest.fn(), cleanupPreviousSlotStatus: jest.fn() }));
jest.mock('../src/telegramService', () => ({ sendTelegramMessage: jest.fn() }));
jest.mock('http', () => ({ __esModule: true, default: { createServer: jest.fn() } }));
jest.mock('../src/logger', () => ({
  __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  sanitizeError: () => ({ name: 'Error', message: 'Operation failed' }),
}));

const originalPort = process.env.PORT;
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  if (originalPort === undefined) delete process.env.PORT;
  else process.env.PORT = originalPort;
});

async function boot(isFull: boolean | null) {
  jest.resetModules();
  jest.useFakeTimers();
  process.env.PORT = '8080';
  const config = require('../src/config');
  config.TELEGRAM_ENABLED = false;
  config.EMAIL_ENABLED = false;
  const worker = require('../src/worker');
  worker.checkUrlAndNotifyOnChange.mockResolvedValue({ isFull });
  const server = { on: jest.fn(), listen: jest.fn((port, callback) => callback()) };
  const http = require('http').default;
  http.createServer.mockReturnValue(server);
  require('../src/index');
  await jest.advanceTimersByTimeAsync(0);
  return { handler: http.createServer.mock.calls[0][0], worker, server };
}

it.each([true, null])('reports liveness and a truthful successful-cycle timestamp for status %s', async status => {
  const { handler, server } = await boot(status);
  const response = { writeHead: jest.fn(), end: jest.fn() };
  handler({ method: 'GET', url: '/healthz' }, response);
  expect(response.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
  const health = JSON.parse(response.end.mock.calls[0][0]);
  expect(health.status).toBe('healthy');
  expect(health.numberOfMonitoredUrls).toBe(1);
  expect(health.memory.rss).toEqual(expect.any(Number));
  if (status === null) expect(health.lastSuccessfulPollCycleTimestamp).toBeNull();
  else expect(Date.parse(health.lastSuccessfulPollCycleTimestamp)).not.toBeNaN();
  expect(server.listen).toHaveBeenCalledWith(8080, expect.any(Function));
});

it('returns 404 for other routes and schedules another polling cycle', async () => {
  const { handler, worker } = await boot(true);
  const response = { writeHead: jest.fn(), end: jest.fn() };
  handler({ method: 'POST', url: '/healthz' }, response);
  expect(response.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'text/plain' });
  expect(worker.checkUrlAndNotifyOnChange).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(66001);
  expect(worker.checkUrlAndNotifyOnChange).toHaveBeenCalledTimes(2);
});
