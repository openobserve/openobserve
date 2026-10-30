const { test, expect } = require('@playwright/test');
const { runFlow } = require('../utils/maestro');
const { q } = require('../utils/ooClient');
const cfg = require('../utils/config');

test.describe('RN Android · View tracking', () => {
  test(
    'navigating screens records named views in _rumdata',
    { tag: ['@mobile', '@rn-android', '@views', '@P1'] },
    async () => {
      const start = Date.now() - 30000;

      // DRIVE — Home → Details → Home → Checkout → Home.
      runFlow('react-native/navigation.yaml');

      // API — the named views were recorded (manual startView sets view.name correctly).
      // Poll until ALL expected views land (they ingest incrementally).
      const required = ['Home', 'Details', 'Checkout'];
      const views = await q.viewsUntil(cfg.RN_SERVICE, start, required, {
        tries: 24,
        delayMs: 5000,
      });
      const names = new Set(views.map((v) => v.view_name));
      for (const expected of required) {
        expect(names.has(expected), `view "${expected}" recorded`).toBeTruthy();
      }

      // Also assert the custom action + the source tag (the two checks coreRumSuite makes that the
      // RN-Android split otherwise omits — navigation.yaml taps "Custom action (tap)").
      const actions = await q.bySql(
        `SELECT type, source FROM ${cfg.RUM_STREAM} WHERE service='${cfg.RN_SERVICE}' AND type='action'`,
        start,
      );
      expect(actions.length, 'a custom action was recorded').toBeGreaterThan(0);
      expect([...new Set(actions.map((a) => a.source))], 'source tag').toContain('react-native');
    },
  );
});
