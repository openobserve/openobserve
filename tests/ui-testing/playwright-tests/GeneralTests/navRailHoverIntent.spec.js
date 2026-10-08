// Timing-sensitive: run serially (--workers=1) against a local stack.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const { NavRailPage } = require('../../pages/generalPages/navRailPage.js');

const SIZES = [
  [1440, 900],
  [1000, 600],
];
const DIRS = ['ltr', 'rtl'];
// The harness "calm" travel.
const CALM_MS = 400;

function pathname(href) {
  return new URL(href, 'http://localhost').pathname;
}

function crosses(start, end, box) {
  // Sample the straight segment and see whether any point lies inside the box.
  for (let t = 0; t <= 1; t += 0.02) {
    const x = start.x + (end.x - start.x) * t;
    const y = start.y + (end.y - start.y) * t;
    if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) return true;
  }
  return false;
}

test.describe('nav rail hover intent', () => {
  test.describe.configure({ mode: 'serial' });

  for (const [w, h] of SIZES) {
    for (const dir of DIRS) {
      test(`AC-2: diagonal travel from a group tile to its far item, across every adjacent group tile, lands the click (${w}x${h} ${dir})`, async ({ page }) => {
        test.setTimeout(240000);
        await page.setViewportSize({ width: w, height: h });
        const rail = new NavRailPage(page);
        await rail.goto('/');
        await rail.setDir(dir);

        const tiles = await rail.railTiles();
        const pairs = [];
        for (let i = 0; i < tiles.length; i++) {
          if (tiles[i].kind !== 'group') continue;
          if (tiles[i + 1]?.kind === 'group') pairs.push({ from: tiles[i].groupKey, across: tiles[i + 1].groupKey, towards: 'last' });
          if (tiles[i - 1]?.kind === 'group') pairs.push({ from: tiles[i].groupKey, across: tiles[i - 1].groupKey, towards: 'first' });
        }
        expect(pairs.length).toBeGreaterThan(0);

        let realCrossings = 0;
        for (const { from, across, towards } of pairs) {
          await rail.resetPointer();
          await rail.setDir(dir);
          await rail.restOn(rail.groupTile(from));
          expect(await rail.openFlyoutKeys(), `${from} flyout opens on rest`).toEqual([from]);

          const items = rail.flyoutItems(from);
          const n = await items.count();
          const item = towards === 'last' ? items.nth(n - 1) : items.first();
          const ib = await item.boundingBox();
          const start = await rail.centre(rail.groupTile(from));
          const end = { x: dir === 'rtl' ? ib.x + ib.width - 24 : ib.x + 24, y: ib.y + ib.height / 2 };
          const acrossBox = await rail.groupTile(across).boundingBox();
          if (crosses(start, end, acrossBox)) realCrossings++;

          const seen = new Set();
          await rail.glide(start, end, CALM_MS, async () => {
            for (const k of await rail.openFlyoutKeys()) seen.add(k);
          });
          // A human clicks ~150 ms after the cursor settles.
          await page.waitForTimeout(150);
          expect([...seen].filter((k) => k !== from), `no neighbour hijacks ${from} -> ${across}`).toEqual([]);
          expect(await rail.openFlyoutKeys(), `${from} still open at click time`).toEqual([from]);

          const href = await item.getAttribute('href');
          const expectedTab = new URL(href, 'http://localhost').searchParams.get('tab');
          await page.mouse.click(end.x, end.y);
          await page.waitForTimeout(700);
          const url = new URL(page.url());
          // A section index may redirect to its first sub-route (/product-analytics -> /overview).
          const landed = url.pathname === pathname(href) || url.pathname.startsWith(`${pathname(href)}/`);
          expect(landed, `click lands on ${href}, got ${url.pathname}`).toBe(true);
          if (expectedTab) expect(url.searchParams.get('tab')).toBe(expectedTab);
          expect(await rail.openFlyoutKeys()).toEqual([]);
        }
        expect(realCrossings, 'at least one path really crosses a neighbour tile').toBeGreaterThan(0);
      });
    }
  }

  test('AC-3: a 1 px scroll of a scroller that does not contain the tile keeps the flyout open; a rail scroll closes it', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    const rail = new NavRailPage(page);
    await rail.goto('/');
    await rail.resetPointer();
    await rail.restOn(rail.groupTile('reliability'));
    expect(await rail.openFlyoutKeys()).toEqual(['reliability']);
    // Park the pointer on the flyout so only the scroll can close it.
    const fb = await rail.flyout('reliability').boundingBox();
    await page.mouse.move(fb.x + 60, fb.y + 60);
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const el = document.createElement('div');
      el.id = 'foreign-scroller';
      el.style.cssText = 'position:fixed;right:0;bottom:0;width:40px;height:40px;overflow:auto';
      el.innerHTML = '<div style="height:400px"></div>';
      document.body.appendChild(el);
      el.scrollTop = 1;
    });
    await page.waitForTimeout(300);
    expect(await rail.openFlyoutKeys()).toEqual(['reliability']);

    // The rail overflows at 1000x600, so its own scroll is a real scroll event.
    await page.evaluate(() => {
      document.querySelector('[data-test="navbar-main-nav"]').scrollTop = 1;
    });
    await page.waitForTimeout(300);
    expect(await rail.openFlyoutKeys()).toEqual([]);
  });

  test('AC-4: a continuous scan from Traces to Settings opens nothing; a rest opens within 300 ms; an open dropdown survives the scan', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const rail = new NavRailPage(page);
    await rail.goto('/');
    await rail.resetPointer();

    // Enter Traces already in motion from the link tile above it, at constant speed.
    const metrics = await rail.centre(rail.tile('/metrics'));
    const start = { x: metrics.x, y: metrics.y + 12 };
    const end = await rail.centre(rail.tile('/settings'));
    const seen = new Set();
    await rail.glide(
      start,
      end,
      600,
      async () => {
        for (const k of await rail.openFlyoutKeys()) seen.add(k);
      },
      'linear',
    );
    expect([...seen], 'tiles only passed over open no flyout').toEqual([]);

    // Rest on Data: the flyout must appear within 300 ms of the rest starting.
    await rail.resetPointer();
    const data = await rail.centre(rail.groupTile('data'));
    await rail.glide(start, data, 400);
    const t0 = Date.now();
    let openedAfter = null;
    while (Date.now() - t0 < 2000) {
      if ((await rail.openFlyoutKeys()).includes('data')) {
        openedAfter = Date.now() - t0;
        break;
      }
      await page.waitForTimeout(10);
    }
    expect(openedAfter, 'Data opens after the rest').not.toBeNull();
    expect(openedAfter).toBeLessThanOrEqual(300);

    // An open header dropdown is not dismissed by tiles merely passed over.
    await rail.resetPointer();
    await rail.profileMenuBtn.click();
    await page.locator('[data-reka-popper-content-wrapper]').first().waitFor({ state: 'visible' });
    await rail.glide(start, end, 600, null, 'linear');
    expect(await page.locator('[data-reka-popper-content-wrapper]').count()).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
  });
});
