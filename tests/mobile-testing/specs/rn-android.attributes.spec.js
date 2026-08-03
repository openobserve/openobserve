const { test, expect } = require('@playwright/test');
const { runFlow } = require('../utils/maestro');
const { search, pollUntil } = require('../utils/ooClient');
const cfg = require('../utils/config');

test.describe('RN Android · Attributes / tagging', () => {
  test(
    'RUM data is tagged with env, service, and version',
    { tag: ['@mobile', '@rn-android', '@attributes', '@P1'] },
    async () => {
      const start = Date.now() - 30000;

      // DRIVE — generate some data.
      runFlow('react-native/network.yaml');

      // API — the app's rows carry the expected env / service / version.
      const rows = await pollUntil(
        () =>
          search(
            `SELECT env, service, version FROM ${cfg.RUM_STREAM} ` +
              `WHERE service='${cfg.RN_SERVICE}'`,
            start,
          ),
        (r) => r.length > 0,
        { tries: 20, delayMs: 5000 },
      );

      expect(rows.length, 'data ingested for the service').toBeGreaterThan(0);
      const row = rows[0];
      expect(row.service).toBe(cfg.RN_SERVICE);
      expect(row.env, `env should be ${cfg.RN_ENV}`).toBe(cfg.RN_ENV);
      expect(row.version, 'app version tagged').toBeTruthy();
    },
  );
});
