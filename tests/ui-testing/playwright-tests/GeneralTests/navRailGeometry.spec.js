// Run serially (--workers=1); the BASE fixture was captured once from 17e771a6c7.

const fs = require('fs');
const path = require('path');
const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const { NavRailPage } = require('../../pages/generalPages/navRailPage.js');
const base = require('./fixtures/rail-geometry-base.json');

const SIZES = [
  [1440, 900],
  [1000, 600],
];
const DIRS = ['ltr', 'rtl'];
const THEMES = ['light', 'dark'];
const SHOTS_DIR = process.env.RAIL_SHOTS_DIR || path.join(__dirname, '../../playwright-results/rail-shots');
// Sub-pixel rounding differs by a hair between runs; anything larger is a real shift.
const TOLERANCE = 1;
const LANGUAGE_COOKIE = 'vue3-typescript-admin-languageKey';

function expectBoxEqual(actual, expected, label) {
  for (const k of ['x', 'y', 'w', 'h']) {
    expect(Math.abs(actual[k] - expected[k]), `${label}.${k} ${actual[k]} vs BASE ${expected[k]}`).toBeLessThanOrEqual(TOLERANCE);
  }
}

async function measure(page) {
  return page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
    };
    const nav = document.querySelector('[data-test="navbar-main-nav"]');
    const tiles = {};
    for (const t of nav.querySelectorAll("a[data-test^='menu-link-'], button[data-test^='menu-link-']")) {
      tiles[t.getAttribute('data-test')] = box(t);
    }
    return {
      rail: box(nav),
      header: box(document.querySelector('.o2-app-header')),
      content: box(document.querySelector('.o2-content-scroll')),
      tiles,
    };
  });
}

async function colours(page) {
  const rail = page.locator('[data-test="navbar-main-nav"]').first();
  const active = rail.locator('.nav-menu-item--active').first();
  const inactive = rail.locator('.nav-menu-item:not(.nav-menu-item--active)').first();
  const out = {
    activeLabel: await active.locator('.nav-menu-item-label').evaluate((el) => getComputedStyle(el).color),
    activeIcon: await active.locator('.icon-wrapper').evaluate((el) => getComputedStyle(el).color),
    pillBg: await rail.locator('[aria-hidden="true"]').first().evaluate((el) => getComputedStyle(el).backgroundColor),
    inactiveLabel: await inactive.locator('.nav-menu-item-label').evaluate((el) => getComputedStyle(el).color),
  };
  await inactive.hover();
  await page.waitForTimeout(400);
  out.hoverLabel = await inactive.locator('.nav-menu-item-label').evaluate((el) => getComputedStyle(el).color);
  out.hoverBg = await inactive.evaluate((el) => getComputedStyle(el).backgroundColor);
  out.hoverIcon = await inactive.locator('.icon-wrapper').evaluate((el) => getComputedStyle(el).color);
  await page.mouse.move(1, 1);
  return out;
}

// `lineGrowth`: a two-word label on the second clamp line (BASE behaviour) adds one line height and shifts the tiles below it.
function compareFrame(actual, expected, label, lineGrowth = {}) {
  expectBoxEqual(actual.rail, expected.rail, `${label} rail`);
  expectBoxEqual(actual.header, expected.header, `${label} header`);
  expectBoxEqual(actual.content, expected.content, `${label} content`);
  expect(Object.keys(actual.tiles).sort(), `${label} tile set`).toEqual(Object.keys(expected.tiles).sort());
  let shift = 0;
  for (const [k, b] of Object.entries(expected.tiles)) {
    const grown = lineGrowth[k] || 0;
    expectBoxEqual(actual.tiles[k], { x: b.x, y: b.y + shift, w: b.w, h: b.h + grown }, `${label} ${k}`);
    shift += grown;
  }
}

// Extra height each tile gains from a label on two lines (0 for single-line labels).
async function lineGrowthOf(rail) {
  return rail.nav.evaluate((nav) => {
    const out = {};
    for (const t of nav.querySelectorAll("a[data-test^='menu-link-'], button[data-test^='menu-link-']")) {
      const label = t.querySelector('.nav-menu-item-label');
      const lineHeight = parseFloat(getComputedStyle(label).lineHeight);
      const lines = Math.round(label.getBoundingClientRect().height / lineHeight);
      out[t.getAttribute('data-test')] = lines > 1 ? (lines - 1) * lineHeight : 0;
    }
    return out;
  });
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), fullPage: false });
}

test.describe('nav rail geometry and screenshots', () => {
  test.describe.configure({ mode: 'serial' });

  for (const theme of THEMES) {
    for (const dir of DIRS) {
      for (const [w, h] of SIZES) {
        const key = `${w}x${h}-${dir}-${theme}`;
        test(`AC-24: boxes match BASE in every new state (${key})`, async ({ page }) => {
          test.setTimeout(180000);
          const expected = base.frames[key];
          expect(expected, `fixture frame ${key}`).toBeTruthy();
          await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
          await page.setViewportSize({ width: w, height: h });
          const rail = new NavRailPage(page);
          await rail.goto('/');
          await rail.setDir(dir);
          expect(await rail.nav.evaluate((nav) => getComputedStyle(nav).width)).toBe('88px');

          // Resting state (fade drawn at 1000x600).
          compareFrame(await measure(page), expected, `${key} rest`);
          if (h === 600) expect((await rail.railState()).overflowBottom).toBe('true');
          await shot(page, `rail-rest-${key}`);

          // Keyboard focus after ArrowDown (focus ring is an outline, no box change).
          await rail.tile('/').focus();
          await page.keyboard.press('ArrowDown');
          await page.waitForTimeout(200);
          compareFrame(await measure(page), expected, `${key} keyboard focus`);
          await shot(page, `rail-keyboard-focus-${key}`);
          await page.keyboard.press('Escape');

          // Hover label colour state (tooltip shown only when a label truncates; English fits).
          await rail.tile('/logs').hover();
          await page.waitForTimeout(400);
          compareFrame(await measure(page), expected, `${key} hover`);
          await shot(page, `rail-hover-${key}`);
          await rail.resetPointer();

          // Flyout open (an overlay: nothing in the rail moves).
          await rail.restOn(rail.groupTile('reliability'));
          expect(await rail.openFlyoutKeys()).toEqual(['reliability']);
          compareFrame(await measure(page), expected, `${key} flyout`);
          await shot(page, `rail-flyout-${key}`);
          await rail.resetPointer();
          await page.waitForTimeout(400);

          // Scrolled-in active tile after a deep link (short screens only).
          if (h === 600) {
            await rail.goto('/settings');
            await rail.setDir(dir);
            const s = await rail.railState();
            expect(s.scrollTop).toBeGreaterThan(0);
            const m = await measure(page);
            expectBoxEqual(m.rail, expected.rail, `${key} scrolled rail`);
            expectBoxEqual(m.header, expected.header, `${key} scrolled header`);
            expectBoxEqual(m.content, expected.content, `${key} scrolled content`);
            // Tiles moved by exactly the rail scroll, nothing else.
            for (const [k, b] of Object.entries(expected.tiles)) {
              expect(Math.abs(m.tiles[k].y - (b.y - s.scrollTop)), `${key} scrolled ${k}.y`).toBeLessThanOrEqual(TOLERANCE);
              expect(Math.abs(m.tiles[k].x - b.x)).toBeLessThanOrEqual(TOLERANCE);
              expect(Math.abs(m.tiles[k].w - b.w)).toBeLessThanOrEqual(TOLERANCE);
              expect(Math.abs(m.tiles[k].h - b.h)).toBeLessThanOrEqual(TOLERANCE);
            }
            await shot(page, `rail-scrolled-settings-${key}`);
          }
        });
      }
    }
  }

  for (const theme of THEMES) {
    test(`AC-24/AC-29: ellipsis labels (de) and the tooltip on a truncated link tile (tr) keep BASE boxes (${theme})`, async ({ page, context }) => {
      test.setTimeout(180000);
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
      const rail = new NavRailPage(page);
      for (const [w, h] of SIZES) {
        const expected = base.frames[`${w}x${h}-ltr-${theme}`];
        await page.setViewportSize({ width: w, height: h });

        await context.addCookies([{ name: LANGUAGE_COOKIE, value: 'de', url: process.env.ZO_BASE_URL }]);
        await rail.goto('/');
        const truncatedDe = await rail.nav.evaluate((nav) =>
          Array.from(nav.querySelectorAll('[data-truncated="true"]')).map((el) => el.getAttribute('data-test')),
        );
        expect(truncatedDe.length, 'German truncates at least one tile').toBeGreaterThan(0);
        compareFrame(await measure(page), expected, `de ${w}x${h} ${theme}`, await lineGrowthOf(rail));
        // Every truncated label draws an ellipsis (text-overflow) inside its box.
        for (const dt of truncatedDe) {
          const style = await rail.nav.locator(`[data-test="${dt}"] .nav-menu-item-label`).evaluate((el) => getComputedStyle(el).textOverflow);
          expect(style).toBe('ellipsis');
        }
        // A truncated group tile shows its full title in the flyout header.
        const group = truncatedDe.find((dt) => dt === 'menu-link-/alerts-item');
        if (group) {
          await rail.restOn(rail.groupTile('reliability'));
          await expect(rail.flyout('reliability')).toContainText('Zuverlässigkeit');
          await shot(page, `rail-ellipsis-de-flyout-${w}x${h}-${theme}`);
          await rail.resetPointer();
        }
        await shot(page, `rail-ellipsis-de-${w}x${h}-${theme}`);

        // Billing, the mockup's truncated link tile, is Cloud-only, so scan the clipped locales for any link tile.
        let link = null;
        for (const lang of ['tr', 'ru', 'nl', 'pl', 'es', 'pt', 'fr', 'it']) {
          await context.addCookies([{ name: LANGUAGE_COOKIE, value: lang, url: process.env.ZO_BASE_URL }]);
          await rail.goto('/');
          const truncatedLinks = await rail.nav.evaluate((nav) =>
            Array.from(nav.querySelectorAll('a[data-truncated="true"]:not([aria-haspopup])')).map((el) => el.getAttribute('data-test')),
          );
          if (truncatedLinks.length) {
            link = truncatedLinks[0].replace(/^menu-link-/, '').replace(/-item$/, '');
            test.info().annotations.push({ type: 'truncated-link-tile', description: `${lang}: ${truncatedLinks[0]}` });
            break;
          }
        }
        if (!link) {
          test.info().annotations.push({
            type: 'skipped-check',
            description: `${w}x${h}: no plain link tile truncates in any clipped locale on this OSS stack (Billing is Cloud-only); the tooltip on a truncated link tile is pinned by MenuLink.spec.ts`,
          });
          continue;
        }
        await rail.tile(link).hover();
        const bubble = page.locator(`[data-test="menu-link-${link}-tooltip"]`);
        await expect(bubble).toBeVisible();
        const fullLabel = await rail.tile(link).getAttribute('aria-label');
        await expect(bubble).toHaveText(fullLabel);
        compareFrame(await measure(page), expected, `tooltip ${w}x${h} ${theme}`, await lineGrowthOf(rail));
        await shot(page, `rail-tooltip-${w}x${h}-${theme}`);
        await rail.resetPointer();
        // Keyboard focus shows the same tooltip.
        await rail.tile(link).focus();
        await expect(bubble).toBeVisible();
        await page.keyboard.press('Escape');
      }
      await context.clearCookies();
    });
  }

  test('AC-13: dark-mode tile colours are identical to BASE; light values recorded', async ({ page }) => {
    const out = {};
    for (const theme of THEMES) {
      await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      const rail = new NavRailPage(page);
      await rail.goto('/');
      out[theme] = await colours(page);
    }
    const baseDark = base.frames['1440x900-ltr-dark'].colours;
    for (const k of ['activeLabel', 'activeIcon', 'pillBg', 'inactiveLabel', 'hoverLabel', 'hoverBg', 'hoverIcon']) {
      expect(out.dark[k], `dark ${k}`).toBe(baseDark[k]);
    }
    const baseLight = base.frames['1440x900-ltr-light'].colours;
    // Only the label token changes in light; icon, pill and hover background stay.
    expect(out.light.activeIcon).toBe(baseLight.activeIcon);
    expect(out.light.pillBg).toBe(baseLight.pillBg);
    expect(out.light.hoverBg).toBe(baseLight.hoverBg);
    expect(out.light.hoverIcon).toBe(baseLight.hoverIcon);
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SHOTS_DIR, 'colours.json'), JSON.stringify({ base: { light: baseLight, dark: baseDark }, now: out }, null, 2));
  });
});
