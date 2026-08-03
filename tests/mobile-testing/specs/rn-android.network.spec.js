const { test, expect } = require('@playwright/test');
const { runFlow } = require('../utils/maestro');
const { q } = require('../utils/ooClient');
const cfg = require('../utils/config');

test.describe('RN Android · Network / resource tracking (A4)', () => {
  test(
    'fetch calls are captured as resources in _rumdata',
    { tag: ['@mobile', '@rn-android', '@network', '@P1'] },
    async () => {
      const start = Date.now() - 30000;

      // DRIVE — success + 404 fetches.
      runFlow('react-native/network.yaml');

      // API — resources captured with url/method/status.
      const resources = await q.resources(cfg.RN_SERVICE, start, { tries: 20, delayMs: 5000 });
      const urls = resources.map((r) => r.resource_url || '');
      expect(resources.length, 'at least one resource captured').toBeGreaterThan(0);
      expect(
        urls.some((u) => u.includes('jsonplaceholder.typicode.com')),
        'the app fetch was tracked as a resource',
      ).toBeTruthy();
    },
  );
});
