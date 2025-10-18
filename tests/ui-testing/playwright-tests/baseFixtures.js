import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { test as baseTest } from '@playwright/test';
const testLogger = require('./utils/test-logger.js');

const istanbulCLIOutput = path.join(process.cwd(), '.nyc_output');

export function generateUUID() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Global test step delay for deployed environment testing
 * Helps with network latency and eventual consistency issues
 */
const TEST_STEP_DELAY_MS = parseInt(process.env.TEST_STEP_DELAY_MS || '0', 10);

/**
 * Adds a configurable delay between test steps
 * Use this when testing against deployed environments to allow for:
 * - Network latency
 * - Data ingestion delays
 * - UI state synchronization
 */
export async function slowDown(customDelay) {
  const delay = customDelay !== undefined ? customDelay : TEST_STEP_DELAY_MS;
  if (delay > 0) {
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

export const test = baseTest.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() =>
      window.addEventListener('beforeunload', () => {
        try {
          (window).collectIstanbulCoverage(JSON.stringify((window).__coverage__))
        } catch (error) {
          testLogger.error('Failed to collect coverage on page unload', { error });
        }
      }),
    );
    await fs.promises.mkdir(istanbulCLIOutput, { recursive: true });
    await context.exposeFunction('collectIstanbulCoverage', async (coverageJSON) => {
      if (!coverageJSON) return;
      const filename = path.join(istanbulCLIOutput, `playwright_coverage_${generateUUID()}.json`);
      try {
        await fs.promises.writeFile(filename, coverageJSON);
      } catch (error) {
        testLogger.error('Failed to write coverage data', { error });
      }
    });
    await use(context);
    await Promise.all(context.pages().map(async (page) => {
      try {
        await page.evaluate(() => (window).collectIstanbulCoverage(JSON.stringify((window).__coverage__)))
      } catch (error) {
        testLogger.error('Failed to collect final coverage for page', { error });
      }
    }));
  },

  page: async ({ page }, use) => {
    // Only add delays if TEST_STEP_DELAY_MS is set (for deployed env testing)
    if (TEST_STEP_DELAY_MS > 0) {
      const originalGoto = page.goto.bind(page);
      const originalClick = page.click.bind(page);
      const originalFill = page.fill.bind(page);

      page.goto = async (...args) => {
        await slowDown();
        return originalGoto(...args);
      };

      page.click = async (...args) => {
        await slowDown();
        return originalClick(...args);
      };

      page.fill = async (...args) => {
        await slowDown();
        return originalFill(...args);
      };
    }

    await use(page);
  }
});

export const expect = test.expect;