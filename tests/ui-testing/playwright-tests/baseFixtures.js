import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { test as baseTest } from '@playwright/test';
const testLogger = require('./utils/test-logger.js');

const istanbulCLIOutput = path.join(process.cwd(), '.nyc_output');

export function generateUUID() {
  return crypto.randomBytes(16).toString('hex');
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
    await use(page);
  }
});

export const expect = test.expect;