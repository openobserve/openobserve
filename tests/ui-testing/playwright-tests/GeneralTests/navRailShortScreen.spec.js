// Run serially (--workers=1): the rail scroll assertions race under parallel workers.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const { NavRailPage } = require('../../pages/generalPages/navRailPage.js');

const SHORT = [
  [1000, 600],
  [960, 480],
];
// Billing is Cloud-only; on this OSS stack the deep-link set is Settings and IAM.
const DEEP_LINKS = [
  ['/settings', '/settings'],
  ['/iam', '/iam'],
];

test.describe('nav rail on short screens', () => {
  test.describe.configure({ mode: 'serial' });

  for (const [w, h] of SHORT) {
    for (const [path, link] of DEEP_LINKS) {
      test(`AC-5: opening ${path} by URL at ${w}x${h} leaves its tile visible and clear of the fade, with 0 actions and no page scroll`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        const rail = new NavRailPage(page);
        await rail.goto(path);
        const s = await rail.railState();
        expect(s.active).toBe(`menu-link-${link}-item`);
        expect(s.docScrollTop).toBe(0);
        expect(s.contentScrollTop).toBe(0);
        expect(s.maxScrollTop).toBeGreaterThan(0);
        expect(s.scrollTop).toBeGreaterThan(0);
        expect(await rail.isClearOfFade(rail.tile(link))).toBe(true);
      });
    }
  }

  test('AC-5: when the active tile is already visible the rail scrollTop does not change', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    const rail = new NavRailPage(page);
    await rail.goto('/logs');
    const s = await rail.railState();
    expect(s.active).toBe('menu-link-/logs-item');
    expect(s.scrollTop).toBe(0);
  });

  test('AC-6: the fade follows the overflowing edge, re-evaluates on scroll and resize, and is absent when nothing overflows', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    const rail = new NavRailPage(page);
    await rail.goto('/');
    let s = await rail.railState();
    expect(s.overflowBottom).toBe('true');
    expect(s.overflowTop).toBeNull();
    expect(s.maskImage).not.toBe('none');
    expect(s.maskImage).toContain('linear-gradient');

    await page.evaluate(() => {
      const nav = document.querySelector('[data-test="navbar-main-nav"]');
      nav.scrollTop = nav.scrollHeight;
    });
    await page.waitForTimeout(300);
    s = await rail.railState();
    expect(s.overflowTop).toBe('true');
    expect(s.overflowBottom).toBeNull();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
    s = await rail.railState();
    expect(s.maxScrollTop).toBe(0);
    expect(s.overflowTop).toBeNull();
    expect(s.overflowBottom).toBeNull();
    expect(s.maskImage).toBe('none');

    await page.setViewportSize({ width: 1000, height: 600 });
    await page.waitForTimeout(500);
    s = await rail.railState();
    expect(s.overflowBottom === 'true' || s.overflowTop === 'true').toBe(true);

    // The cue is a mask on the rail's own box: nothing was added to the DOM.
    const railWidth = await rail.nav.evaluate((nav) => nav.getBoundingClientRect().width);
    expect(railWidth).toBe(88);
  });

  test('AC-6 (D-36): the mobile drawer nav gets no fade and no overflow attributes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const rail = new NavRailPage(page);
    await page.goto(rail.url('/'), { waitUntil: 'domcontentloaded' });
    await rail.drawerToggle.waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(1000);
    await rail.openDrawer();
    const state = await rail.drawerNav.evaluate((nav) => ({
      mask: getComputedStyle(nav).maskImage,
      top: nav.getAttribute('data-overflow-top'),
      bottom: nav.getAttribute('data-overflow-bottom'),
    }));
    expect(state.mask).toBe('none');
    expect(state.top).toBeNull();
    expect(state.bottom).toBeNull();
  });

  test('AC-5 (R-3): keyboard focus lands a tile fully outside the fade band', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    const rail = new NavRailPage(page);
    await rail.goto('/');
    await rail.tile('/').focus();
    // ArrowDown until Data (the tile that sits half under the bottom fade at rest).
    for (let i = 0; i < 12; i++) {
      const active = await rail.activeElementDataTest();
      if (active?.dataTest === 'menu-link-/streams-item') break;
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(80);
    }
    expect((await rail.activeElementDataTest())?.dataTest).toBe('menu-link-/streams-item');
    await page.waitForTimeout(200);
    expect(await rail.isClearOfFade(rail.tile('/streams'))).toBe(true);

    // ArrowUp from Home wraps to Settings, below the fold: it is revealed too.
    await rail.tile('/').focus();
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);
    expect((await rail.activeElementDataTest())?.dataTest).toBe('menu-link-/settings-item');
    expect(await rail.isClearOfFade(rail.tile('/settings'))).toBe(true);
    const s = await rail.railState();
    expect(s.docScrollTop).toBe(0);
    expect(s.contentScrollTop).toBe(0);
  });

  test('AC-5 (G-3): a mouse click on a half-faded tile leaves the rail scrollTop unchanged', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    const rail = new NavRailPage(page);
    await rail.goto('/');
    const before = await rail.railState();
    expect(before.scrollTop).toBe(0);
    // Data sits partly under the bottom fade at rest; click its visible part.
    const box = await rail.tile('/streams').boundingBox();
    expect(await rail.isClearOfFade(rail.tile('/streams'))).toBe(false);
    await page.mouse.click(box.x + box.width / 2, box.y + 10);
    await page.waitForTimeout(800);
    const after = await rail.railState();
    expect(after.active).toBe('menu-link-/streams-item');
    expect(after.scrollTop).toBe(0);
  });
});
