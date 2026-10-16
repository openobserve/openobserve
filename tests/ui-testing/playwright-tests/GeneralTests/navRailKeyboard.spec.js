// Header and Language-row keys live in navRailHeaderKeyboard.spec.js.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const { NavRailPage } = require('../../pages/generalPages/navRailPage.js');

test.describe('nav rail keyboard', () => {
  test.describe.configure({ mode: 'serial' });

  test('AC-8: Tab leaves the flyout to content, Shift+Tab returns to the tile, Enter navigates and refocuses the tile, never body', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const rail = new NavRailPage(page);
    await rail.goto('/');
    await rail.resetPointer();

    const tile = rail.groupTile('reliability');
    await tile.focus();
    expect((await rail.activeElementDataTest())?.dataTest).toBe('menu-link-/alerts-item');

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    expect(await rail.openFlyoutKeys()).toEqual(['reliability']);
    let active = await rail.activeElementDataTest();
    expect(active?.dataTest).toMatch(/^nav-group-item-/);
    const firstItem = active.dataTest;

    await page.keyboard.press('ArrowDown');
    active = await rail.activeElementDataTest();
    expect(active?.dataTest).toMatch(/^nav-group-item-/);
    expect(active.dataTest).not.toBe(firstItem);

    // Shift+Tab: closes and focuses the owning tile.
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(200);
    expect(await rail.openFlyoutKeys()).toEqual([]);
    expect((await rail.activeElementDataTest())?.dataTest).toBe('menu-link-/alerts-item');

    // Tab: closes and moves on as Tab from the tile would (into the content area).
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    expect(await rail.openFlyoutKeys()).toEqual(['reliability']);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    expect(await rail.openFlyoutKeys()).toEqual([]);
    active = await rail.activeElementDataTest();
    expect(active?.tag).not.toBe('BODY');
    expect(active?.inContent).toBe(true);

    // Enter on an item: navigates, closes, focus back on the owning tile.
    await tile.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowDown');
    const chosen = await page.evaluate(() => document.activeElement.getAttribute('href'));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    expect(new URL(page.url()).pathname).toBe(new URL(chosen, 'http://localhost').pathname);
    expect(await rail.openFlyoutKeys()).toEqual([]);
    active = await rail.activeElementDataTest();
    expect(active?.tag).not.toBe('BODY');
    expect(active?.dataTest).toBe('menu-link-/alerts-item');

    // Space on an item behaves like Enter.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const chosen2 = await page.evaluate(() => document.activeElement.getAttribute('href'));
    await page.keyboard.press('Space');
    await page.waitForTimeout(800);
    expect(new URL(page.url()).pathname).toBe(new URL(chosen2, 'http://localhost').pathname);
    expect(await rail.openFlyoutKeys()).toEqual([]);
    expect((await rail.activeElementDataTest())?.dataTest).toBe('menu-link-/alerts-item');

    // Enter on the group tile itself: navigates and leaves no flyout open.
    await rail.groupTile('data').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    expect(await rail.openFlyoutKeys()).toEqual(['data']);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    expect(new URL(page.url()).pathname).toBe('/web/streams');
    expect(await rail.openFlyoutKeys()).toEqual([]);
    expect((await rail.activeElementDataTest())?.tag).not.toBe('BODY');
  });

  test('AC-27: choosing a flyout item with the mouse never restores focus to the tile', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const rail = new NavRailPage(page);
    await rail.goto('/');
    await rail.resetPointer();
    await rail.restOn(rail.groupTile('data'));
    expect(await rail.openFlyoutKeys()).toEqual(['data']);
    const item = rail.flyoutItems('data').nth(1);
    const href = await item.getAttribute('href');
    await item.click();
    await page.waitForTimeout(1200);
    expect(new URL(page.url()).pathname).toBe(new URL(href, 'http://localhost').pathname);
    expect(await rail.openFlyoutKeys()).toEqual([]);
    const active = await rail.activeElementDataTest();
    expect(active?.dataTest).not.toBe('menu-link-/streams-item');
  });

  test('AC-17: in the 390x844 drawer, scrolling after expanding Reliability leaves it expanded where the user left it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const rail = new NavRailPage(page);
    await page.goto(rail.url('/'), { waitUntil: 'domcontentloaded' });
    await rail.drawerToggle.waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(1000);
    await rail.openDrawer();
    const group = rail.drawerNav.locator('[data-test="nav-group-reliability"] .nav-menu-item');
    await group.click();
    const inline = rail.drawerNav.locator('[data-test="nav-group-inline-reliability"]');
    await expect(inline).toBeVisible();

    const scrolled = await rail.drawerNav.evaluate((nav) => {
      const scroller = nav.scrollHeight > nav.clientHeight ? nav : nav.closest('[data-test="main-layout-mobile-nav-drawer"]');
      scroller.scrollTop = 100;
      scroller.dispatchEvent(new Event('scroll'));
      return scroller.scrollTop;
    });
    await page.waitForTimeout(400);
    await expect(inline).toBeVisible();
    const after = await rail.drawerNav.evaluate((nav) => {
      const scroller = nav.scrollHeight > nav.clientHeight ? nav : nav.closest('[data-test="main-layout-mobile-nav-drawer"]');
      return scroller.scrollTop;
    });
    expect(after).toBe(scrolled);
  });
});
