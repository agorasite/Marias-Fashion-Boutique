const { defineConfig, devices } = require('@playwright/test');

// 6 parallel workers by default: every test opens a fresh browser context (~70 requests on loopback);
// more workers buy little time and, on a busy Windows machine, can exhaust socket buffers
// (net::ERR_NO_BUFFER_SPACE). Override with PW_WORKERS=<n>. No retries: a failure is a bug.
const workers = process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : 6;

module.exports = defineConfig({
  testDir: './e2e',
  workers,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
