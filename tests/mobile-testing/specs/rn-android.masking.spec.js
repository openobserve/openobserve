const { test } = require('@playwright/test');
const { runFlow } = require('../utils/maestro');
const { q } = require('../utils/ooClient');
const { RumDashboardPage } = require('../pages/rumDashboardPage');
const cfg = require('../utils/config');

// The app is built with Session Replay textAndInputPrivacyLevel = MASK_ALL, so no
// on-screen text (incl. the Checkout email/card/password) may appear in the replay.
const PII = ['alex.morgan@example.com', '4242 4242 4242 4242'];

test.describe('RN Android · Session Replay privacy masking', () => {
  test(
    'PII is masked in the session replay (MASK_ALL)',
    { tag: ['@mobile', '@rn-android', '@replay', '@masking', '@P1'] },
    async ({ page }) => {
      const start = Date.now() - 30000;

      // DRIVE — visit the Checkout screen holding PII and dwell so replay records it.
      runFlow('react-native/masking.yaml');

      // Find the session that recorded it.
      const sessionId = await q.sessionForService(cfg.RN_SERVICE, start, {
        tries: 20,
        delayMs: 5000,
      });
      if (!sessionId) throw new Error('no session ingested for masking flow');

      // UI — open the replay and assert NO raw PII leaked into the replay DOM.
      const dash = new RumDashboardPage(page);
      await dash.login();
      await dash.openSession(sessionId);
      await page.waitForTimeout(4000); // let the replay player render
      await dash.expectNoPiiInReplay(PII);
    },
  );
});
