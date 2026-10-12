// Page object for the left rail, its hover flyouts and the mobile drawer nav.

const FRAME_MS = 16;
// Minimum-jerk profile: the bell-shaped velocity of a real aimed hand movement.
const ease = (t) => 10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5;
// The rail mask fades the last 3rem of an overflowing edge (railReveal.ts RAIL_FADE_REM).
const RAIL_FADE_REM = 3;

export class NavRailPage {
  constructor(page) {
    this.page = page;
    // The desktop rail comes first in DOM order; the drawer renders its own nav.
    this.nav = page.locator('[data-test="navbar-main-nav"]').first();
    this.drawerToggle = page.locator('[data-test="header-mobile-nav-toggle"]');
    this.drawerNav = page.locator(
      '[data-test="main-layout-mobile-nav-drawer"] [data-test="navbar-main-nav"]',
    );
    this.contentScroll = page.locator('.o2-content-scroll');
    this.profileMenuBtn = page.locator('[data-test="header-my-account-profile-icon"]');
  }

  url(path = '/') {
    const base = (process.env.ZO_BASE_URL || '').replace(/\/+$/, '');
    const org = process.env.ORGNAME || 'default';
    const sep = path.includes('?') ? '&' : '?';
    return `${base}/web${path}${sep}org_identifier=${org}`;
  }

  async goto(path = '/') {
    await this.page.goto(this.url(path), { waitUntil: 'domcontentloaded' });
    await this.nav.locator('.nav-menu-item--active').first().waitFor({ state: 'attached', timeout: 60000 });
    // Config-driven tiles settle a beat after the first paint.
    await this.page.waitForTimeout(1000);
  }

  async setDir(dir) {
    await this.page.evaluate((d) => {
      document.documentElement.dir = d;
    }, dir);
    await this.page.waitForTimeout(300);
  }

  tile(link) {
    return this.nav.locator(`[data-test="menu-link-${link}-item"]`);
  }

  groupTile(key) {
    return this.nav.locator(`[data-test="nav-group-${key}"] .nav-menu-item`);
  }

  flyout(key) {
    return this.page.locator(`[data-test="nav-group-flyout-${key}"]`);
  }

  flyoutItems(key) {
    return this.flyout(key).locator("a[data-test^='nav-group-item-']");
  }

  async openFlyoutKeys() {
    return this.page.$$eval("[data-test^='nav-group-flyout-']", (els) =>
      els
        .map((e) => e.getAttribute('data-test').replace('nav-group-flyout-', ''))
        .filter((k) => !k.endsWith('-trial-note')),
    );
  }

  // Rail tiles in order: { dataTest, kind: 'link' | 'group', groupKey }.
  async railTiles() {
    return this.nav.evaluate((nav) =>
      Array.from(nav.querySelectorAll("a[data-test^='menu-link-'], button[data-test^='menu-link-']")).map(
        (el) => {
          const group = el.closest("[data-test^='nav-group-']");
          const key = group ? group.getAttribute('data-test').replace('nav-group-', '') : null;
          return { dataTest: el.getAttribute('data-test'), kind: key ? 'group' : 'link', groupKey: key };
        },
      ),
    );
  }

  async railState() {
    return this.page.evaluate((fadeRem) => {
      const nav = document.querySelector('[data-test="navbar-main-nav"]');
      const active = nav.querySelector('.nav-menu-item--active');
      const r = nav.getBoundingClientRect();
      const a = active ? active.getBoundingClientRect() : null;
      const content = document.querySelector('.o2-content-scroll');
      return {
        scrollTop: nav.scrollTop,
        maxScrollTop: nav.scrollHeight - nav.clientHeight,
        overflowTop: nav.getAttribute('data-overflow-top'),
        overflowBottom: nav.getAttribute('data-overflow-bottom'),
        maskImage: getComputedStyle(nav).maskImage,
        docScrollTop: document.scrollingElement.scrollTop,
        contentScrollTop: content ? content.scrollTop : null,
        active: active ? active.getAttribute('data-test') : null,
        rail: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
        activeBox: a ? { top: a.top, bottom: a.bottom } : null,
        fadePx: fadeRem * parseFloat(getComputedStyle(document.documentElement).fontSize),
      };
    }, RAIL_FADE_REM);
  }

  // Whether a tile sits fully inside the rail and outside any drawn fade band.
  async isClearOfFade(tileLocator) {
    const box = await tileLocator.boundingBox();
    const s = await this.railState();
    const top = s.rail.top + (s.overflowTop ? s.fadePx : 0);
    const bottom = s.rail.bottom - (s.overflowBottom ? s.fadePx : 0);
    return box.y >= top - 0.5 && box.y + box.height <= bottom + 0.5;
  }

  async resetPointer() {
    const vp = this.page.viewportSize();
    await this.page.mouse.move(vp.width - 40, vp.height - 40);
    await this.page.waitForTimeout(500);
  }

  async centre(locator) {
    const b = await locator.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }

  // Move onto a tile and let the pointer rest until the flyout is open.
  async restOn(locator) {
    const c = await this.centre(locator);
    await this.page.mouse.move(c.x, c.y);
    await this.page.waitForTimeout(450);
  }

  // Straight travel at ~60 Hz with a human velocity profile (or constant speed); onStep samples each frame.
  async glide(start, end, durationMs, onStep, profile = 'ease') {
    const steps = Math.max(2, Math.round(durationMs / FRAME_MS));
    for (let i = 1; i <= steps; i++) {
      const k = profile === 'linear' ? i / steps : ease(i / steps);
      await this.page.mouse.move(start.x + (end.x - start.x) * k, start.y + (end.y - start.y) * k);
      await this.page.waitForTimeout(FRAME_MS);
      if (onStep) await onStep(i, steps);
    }
  }

  async activeElementDataTest() {
    return this.page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName, dataTest: el.getAttribute('data-test'), inContent: !!el.closest('.o2-content-scroll') } : null;
    });
  }

  async openDrawer() {
    await this.drawerToggle.click();
    await this.drawerNav.waitFor({ state: 'visible' });
    await this.page.waitForTimeout(400);
  }
}
