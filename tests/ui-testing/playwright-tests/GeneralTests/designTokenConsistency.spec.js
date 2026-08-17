const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Design Token Migration & Design System Consistency testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    // Authenticate + land on the app shell (handled by navigateToBase; no login steps).
    await navigateToBase(page);
    pm = new PageManager(page);

    // Post-authentication stabilization — the profile button is the first
    // user-actionable element after the layout shell hydrates.
    await page.waitForLoadState('domcontentloaded');
    await expect(pm.themePage.profileMenuBtn).toBeVisible({ timeout: 10000 });

    testLogger.info('Design token consistency test setup completed');
  });

  test.afterEach(async () => {
    // Restore light mode so no test leaves a dark/custom theme behind. Each test
    // runs in its own context (parallel-safe), but this keeps a clean slate.
    try {
      await pm.themePage.switchToLightMode();
    } catch (e) {
      // Ignore errors in cleanup
    }
    testLogger.info('Design token consistency test completed');
  });

  test("should resolve semantic tokens non-empty and flip values in dark mode", {
    tag: ['@design-token-migration', '@tokens', '@darkMode', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing semantic token resolution and dark-mode flip');

    // Normalize start state to light mode.
    await pm.themePage.switchToLightMode();
    await pm.themePage.expectLightMode();

    const light = await pm.themePage.getTokenSnapshot();
    testLogger.info('Light token snapshot', light);

    // The dark-mode signal lives on <html>, not <body> (legacy body--dark is retired).
    const lightDarkSignal = await page.evaluate(
      () => document.documentElement.classList.contains('dark')
    );
    expect(lightDarkSignal).toBe(false);

    // Switch to dark and wait for the `.dark` class to actually land on <html>
    // (the view transition can leave a mid-transition state otherwise).
    await pm.themePage.switchToDarkMode();
    await page.waitForFunction(
      () => document.documentElement.classList.contains('dark'),
      { timeout: 10000 }
    );

    const dark = await pm.themePage.getTokenSnapshot();
    testLogger.info('Dark token snapshot', dark);

    // Cleanup before asserting (assertions run even if a prior step throws).
    await pm.themePage.switchToLightMode();

    // Theme-independent assertions: non-empty in both themes (never hardcoded hex),
    // and the two tokens guaranteed to flip differ between light and dark.
    for (const [key, value] of Object.entries(light)) {
      expect(value.length, `light ${key} should be non-empty`).toBeGreaterThan(0);
    }
    for (const [key, value] of Object.entries(dark)) {
      expect(value.length, `dark ${key} should be non-empty`).toBeGreaterThan(0);
    }
    expect(dark.accent).not.toBe(light.accent);
    expect(dark.surfaceBase).not.toBe(light.surfaceBase);

    testLogger.info('Token resolution and dark-mode flip test completed');
  });

  test("should emit token-based variant classes and stable hooks on OButton without raw palette classes", {
    tag: ['@design-token-migration', '@button', '@componentTokens', '@P0', '@all']
  }, async () => {
    testLogger.info('Testing OButton token classes and stable hooks');

    // Waits for the first primary OButton, then asserts token utilities + hooks
    // and the absence of raw ramp classes (bg-primary-* / bg-gray-*).
    await pm.designTokenPage.expectPrimaryButtonTokenClasses();

    testLogger.info('OButton token classes and hooks test completed');
  });

  test("should render token chrome and slug matrix on the Streams list OTable", {
    tag: ['@design-token-migration', '@table', '@componentTokens', '@P1', '@all']
  }, async () => {
    testLogger.info('Testing OTable token chrome and slug matrix on the Streams list');

    // Navigate to the Streams list — renders an OTable even when empty (header chrome).
    await pm.streamsPage.gotoStreamsPage();
    await expect(pm.streamsPage.streamsTable).toBeVisible({ timeout: 15000 });

    // Asserts the o2-table mounts and its header chrome carries token classes.
    await pm.designTokenPage.expectTableChrome();

    testLogger.info('OTable token chrome and slug matrix test completed');
  });

  test("should resolve primary OButton background from --color-button-primary without a phantom dark flip", {
    tag: ['@design-token-migration', '@button', '@componentTokens', '@P1', '@all']
  }, async () => {
    testLogger.info('Testing primary OButton background resolves from the component token');

    // Normalize to light mode for a stable baseline.
    await pm.themePage.switchToLightMode();
    await pm.themePage.expectLightMode();

    // Linkage: the button's computed background-color equals the resolved
    // --color-button-primary token (probe element — no hardcoded hex, robust
    // under custom themes that override --color-primary-* inline).
    await pm.designTokenPage.expectPrimaryButtonBackgroundResolvesFromToken();

    // No phantom flip: --color-button-primary → --color-primary-600 is a brand
    // accent not overridden in dark.css, so the button must stay the same color
    // after toggling dark. Toggle and re-read, then assert the background is
    // unchanged (the negative claim in the test name).
    const lightBackground = await pm.designTokenPage.getPrimaryButtonBackground();
    await pm.themePage.switchToDarkMode();
    await pm.themePage.expectDarkMode();
    const darkBackground = await pm.designTokenPage.getPrimaryButtonBackground();
    expect(darkBackground).toBe(lightBackground);

    // Restore light mode so this test leaves a clean slate.
    await pm.themePage.switchToLightMode();

    testLogger.info('Primary OButton background token test completed');
  });

  test.fixme("should derive child slugs and token chrome on a schema index-type OSelect — data-gated: requires a stream with ≥1 field (schema.vue:409)", {
    tag: ['@design-token-migration', '@select', '@componentTokens', '@P1', '@all']
  }, async () => {
    // data-gated — the schema index-type OSelect only renders when a stream with at
    // least one defined field exists, which this suite does not guarantee. Real
    // assertion body kept intact so it goes green once such a stream is present.
    testLogger.info('Testing OSelect derived slugs and token chrome (data-gated)');

    // Open the Streams list, then an existing stream's schema view, and assert the
    // derived `<parent>-trigger` / `<parent>-popover` slugs + `bg-select-content-bg`.
    // Parent slug example (per schema.vue:409): schema-field-<fieldName>-index-type-select.
    await pm.schemaPage.navigateToStreams();
    await pm.designTokenPage.expectSelectChrome('schema-field-kubernetes_host-index-type-select');

    testLogger.info('OSelect derived slugs and token chrome test completed');
  });

  test.fixme("sticky-column shadow tokens — data-gated: needs pivot table with sticky columns (useStickyColumns.ts:59-64)", {
    tag: ['@design-token-migration', '@pivot', '@P2', '@all']
  }, async () => {
    // data-gated — --shadow-sticky-left/right/footer are only *consumed* by
    // useStickyColumns inside a pivot table with sticky columns, which requires
    // specific pivot data out of scope for the core (data-free) assertions.
    // The resolution assertion is real and kept intact so it goes green the
    // moment the fixme lifts.
    testLogger.info('Testing sticky-column shadow tokens resolve (data-gated)');

    await pm.designTokenPage.expectStickyShadowTokensResolve();

    testLogger.info('Sticky-column shadow tokens test completed');
  });
});
