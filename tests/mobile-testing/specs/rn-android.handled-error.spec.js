const { test, expect } = require('@playwright/test');
const { runFlow } = require('../utils/maestro');
const { q } = require('../utils/ooClient');
const cfg = require('../utils/config');

test.describe('RN Android · Handled JS error (A5)', () => {
  test(
    'a handled error reported via the SDK lands in _rumdata',
    { tag: ['@mobile', '@rn-android', '@errors', '@P1'] },
    async () => {
      const start = Date.now() - 30000;

      // DRIVE — tap "Trigger handled error".
      runFlow('react-native/handled-error.yaml');

      // API — the handled error is present with the right source.
      const errors = await q.errors(cfg.RN_SERVICE, start, { tries: 20, delayMs: 5000 });
      const handled = errors.find((e) =>
        (e.error_message || '').includes('handled error from Home'),
      );
      expect(handled, 'handled error ingested to _rumdata').toBeTruthy();
      // not a crash — assert on the value itself so a failure shows what error_is_crash actually was.
      expect(handled.error_is_crash, 'handled error must not be flagged as a crash').not.toBe(true);
    },
  );
});
