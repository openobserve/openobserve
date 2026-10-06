import { expect } from '@playwright/test';

const SUB_TABS = ['overview', 'funnels', 'paths', 'retention', 'events'];

/** The analytics URL codec: base64url of the JSON definition with '.' padding (b64EncodeUnicode). */
export function encodeDef(value) {
    return Buffer.from(JSON.stringify(value), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '.');
}

export class RumProductAnalyticsPage {
    constructor(page) {
        this.page = page;
        this.base = (process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/$/, '');
        this.org = process.env.ORGNAME || 'default';

        this.root = page.locator('[data-test="rum-analytics-page"]');
        this.rumTabs = page.locator('[data-test^="rum-tab-"][role="tab"]');
        // Experience's tile links to /rum, so this is the Experience tile whenever the group forms.
        this.rumMenuLink = page.locator('[data-test="nav-group-experience"] [data-test="menu-link-/rum-item"]');
        this.menuFlyout = page.locator('[data-test="nav-group-flyout-experience"]');
        this.menuFlyoutItems = this.menuFlyout.locator('[data-test^="nav-group-item-"]');
        this.menuLink = this.menuFlyout.locator('[data-test="nav-group-item-productAnalytics"]');
        this.appSelect = page.locator('[data-test="rum-analytics-app-select-trigger"]');
        this.appLabel = page.locator('[data-test="rum-analytics-app-label"]');
        this.envSelect = page.locator('[data-test="rum-analytics-env-select"]');
        this.refreshBtn = page.locator('[data-test="rum-analytics-refresh-btn"]');
        this.shareBtn = page.locator('[data-test="rum-analytics-share-btn"]');
        this.newEventBtn = page.locator('[data-test="rum-analytics-named-events-new-btn"]');

        this.overview = page.locator('[data-test="rum-analytics-overview"]');
        this.overviewEmpty = page.locator('[data-test="rum-analytics-overview-empty"]');
        this.widenRangeBtn = page.locator('[data-test="rum-analytics-overview-widen-range-btn"]');
        this.pagesTable = page.locator('[data-test="rum-analytics-overview-pages-table"]');
        this.clicksTable = page.locator('[data-test="rum-analytics-overview-clicks-table"]');
        this.clicksNotCaptured = page.locator('[data-test="rum-analytics-overview-clicks-not-captured"]');
        this.clicksSetupLink = page.locator('[data-test="rum-analytics-overview-clicks-setup-link"]');
        this.featuresTable = page.locator('[data-test="rum-analytics-overview-features-table"]');
        this.trends = page.locator('[data-test="rum-analytics-trends"]');
        this.trendsAddDashboardBtn = page.locator('[data-test="rum-analytics-trends-add-dashboard-btn"]');

        this.funnels = page.locator('[data-test="rum-analytics-funnels"]');
        this.funnelCold = page.locator('[data-test="rum-analytics-funnel-cold"]');
        this.funnelOrderLabel = page.locator('[data-test="rum-analytics-funnel-order-label"]');
        this.funnelAddDashboardBtn = page.locator('[data-test="rum-analytics-funnel-add-dashboard-btn"]');
        this.breakdownSelect = page.locator('[data-test="rum-analytics-funnel-breakdown-select"]');
        this.breakdown = page.locator('[data-test="rum-analytics-funnel-breakdown"]');

        this.dropoffDrawer = page.locator('[data-test="rum-analytics-dropoff-drawer"]');

        this.paths = page.locator('[data-test="rum-analytics-paths"]');
        this.pathsFlow = page.locator('[data-test="rum-analytics-paths-flow"]');
        this.pathsTopTable = page.locator('[data-test="rum-analytics-paths-top-table"]');
        this.pathsSessionFilter = page.locator('[data-test="rum-analytics-paths-session-filter"]');
        this.branchDrawer = page.locator('[data-test="rum-analytics-paths-branch-drawer"]');

        this.retention = page.locator('[data-test="rum-analytics-retention"]');
        this.retentionGrid = page.locator('[data-test="rum-analytics-retention-grid"]');
        this.retentionUnlock = page.locator('[data-test="rum-analytics-retention-unlock"]');
        this.retentionCellDrawer = page.locator('[data-test="rum-analytics-retention-cell-drawer"]');

        this.namedEventsList = page.locator('[data-test="rum-analytics-events-list"]');
        this.eventEditor = page.locator('[data-test="rum-analytics-event-editor"]');
        this.eventSaveBtn = page.locator('[data-test="rum-analytics-event-editor-save-btn"]');
        this.addToDashboardDialog = page.locator('[data-test="add-to-dashboard-dialog"]');
        this.addToDashboardNotice = page.locator('[data-test="add-to-dashboard-notice"]');

        this.sessionViewerContext = page.locator('[data-test="session-viewer-analytics-context"]');
        this.sessionViewerEventsOnly = page.locator('[data-test="session-viewer-events-only"]');
        this.sessionViewerStepMark = page.locator('[data-test="session-viewer-funnel-step-mark"]');
        this.sessionViewerNoReplay = page.locator('[data-test="session-viewer-no-replay"]');
    }

    /** Pins _rumdata's reported doc_time_min to the seed start: stream stats pick up back-dated rows only on their next run. */
    async pinRumDataStart(dataStartUs) {
        const patch = (node) => {
            if (Array.isArray(node)) return node.forEach(patch);
            if (!node || typeof node !== 'object') return;
            if (node.name === '_rumdata' && node.stats && Number(node.stats.doc_time_min) > dataStartUs) {
                node.stats.doc_time_min = dataStartUs;
            }
            Object.values(node).forEach(patch);
        };
        await this.page.route(/\/api\/[^/]+\/streams(\/_rumdata\/schema)?(\?|$)/, async (route) => {
            try {
                const res = await route.fetch();
                const json = await res.json();
                patch(json);
                await route.fulfill({ response: res, json });
            } catch {
                // The page closed mid-request, or the body was not JSON: nothing to patch.
                await route.continue().catch(() => {});
            }
        });
    }

    async goto(subTab = null, params = {}) {
        const path = subTab ? `/web/product-analytics/${subTab}` : '/web/product-analytics';
        const url = new URL(`${this.base}${path}`);
        url.searchParams.set('org_identifier', this.org);
        for (const [k, v] of Object.entries(params)) {
            for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(item));
        }
        await this.page.goto(url.toString());
        await expect(this.root).toBeVisible({ timeout: 30000 });
    }

    async gotoRum(path = '') {
        await this.page.goto(`${this.base}/web/rum${path}?org_identifier=${this.org}`);
    }

    async openExperienceMenu() {
        // A pointer still resting on the tile after clicking it fires no new mouseenter, so step off first.
        await this.page.mouse.move(0, 0);
        await this.rumMenuLink.hover();
        await expect(this.menuFlyout).toBeVisible();
    }

    /** Opens Product Analytics from the Experience flyout, as a user arriving from another module would. */
    async openFromMenu() {
        await this.openExperienceMenu();
        await this.menuLink.click();
    }

    subTab(name) {
        return this.page.locator(`[data-test="rum-analytics-subtab-${name}"]`);
    }

    async openSubTab(name) {
        await this.subTab(name).click();
        await expect(this.page).toHaveURL(new RegExp(`/product-analytics/${name}`));
    }

    async expectSubTabActive(name) {
        await expect(this.subTab(name)).toHaveAttribute('data-state', 'active');
    }

    subTabNames() {
        return SUB_TABS;
    }

    query() {
        return new URL(this.page.url()).searchParams;
    }


    async pickOption(dataTest, { label = null, value = null, search = null } = {}) {
        await this.page.locator(`[data-test="${dataTest}-trigger"]`).click();
        if (search !== null) {
            await this.page.locator(`[data-test="${dataTest}-search"]`).fill(search);
        }
        const option = label !== null
            ? this.page.locator(`[data-test="${dataTest}-option"][data-test-label="${label}"]`)
            : this.page.locator(`[data-test="${dataTest}-option"][data-test-value="${value}"]`);
        await expect(option.first()).toBeVisible({ timeout: 20000 });
        await option.first().click();
    }

    async closePopovers() {
        await this.page.keyboard.press('Escape');
    }


    rankedRow(table, index, cell) {
        return this.page.locator(`[data-test="rum-analytics-overview-${table}-table-row-${index}-${cell}"]`);
    }

    async rankedKeys(table) {
        const keys = this.page.locator(`[data-test^="rum-analytics-overview-${table}-table-row-"][data-test$="-key"]`);
        await expect(keys.first()).toBeVisible({ timeout: 30000 });
        return (await keys.allInnerTexts()).map((s) => s.trim());
    }

    async rowIndexOf(table, key) {
        const keys = await this.rankedKeys(table);
        const i = keys.findIndex((k) => k === key);
        expect(i, `${table} lists ${key} (got ${keys.join(', ')})`).toBeGreaterThanOrEqual(0);
        return i;
    }

    /** Clicks a row action; the actions sit behind hover, so the row is hovered first. */
    async rowAction(table, index, action) {
        const key = this.rankedRow(table, index, 'key');
        await key.hover();
        const btn = this.rankedRow(table, index, action);
        await btn.click();
    }

    async numberIn(locator) {
        const text = (await locator.innerText()).replace(/[~,\s]/g, '');
        return Number(text);
    }


    stepCount(i) {
        return this.page.locator(`[data-test="rum-analytics-funnel-step-${i}-count"]`);
    }

    step(i) {
        return this.page.locator(`[data-test="rum-analytics-funnel-step-${i}"]`);
    }

    async funnelCounts(n) {
        const out = [];
        for (let i = 0; i < n; i++) {
            await expect(this.stepCount(i)).toBeVisible({ timeout: 30000 });
            out.push(await this.numberIn(this.stepCount(i)));
        }
        return out;
    }

    /** Polls until the funnel shows exactly these counts, since each edit recomputes after a debounce. */
    async expectFunnelCounts(expected, timeout = 30000) {
        await expect
            .poll(async () => {
                if ((await this.page.locator('[data-test^="rum-analytics-funnel-step-"][data-test$="-count"]').count()) !== expected.length) {
                    return null;
                }
                return this.funnelCounts(expected.length);
            }, { timeout, intervals: [500, 1000, 2000] })
            .toEqual(expected);
    }

    suggestion(text) {
        return this.page.locator('[data-test^="rum-analytics-funnel-suggestion-"]').filter({ hasText: text });
    }

    dropoffBtn(i) {
        return this.page.locator(`[data-test="rum-analytics-funnel-dropoff-${i}"]`);
    }

    topPathSessionsBtn(i) {
        return this.page.locator(`[data-test="rum-analytics-paths-top-row-${i}-sessions-btn"]`);
    }

    async openDropoff(i) {
        await expect(this.dropoffBtn(i)).toHaveAttribute('aria-haspopup', 'dialog');
        await this.dropoffBtn(i).click();
        await expect(this.dropoffDrawer).toBeVisible();
        await this.expectFullHeight(this.dropoffDrawer);
    }

    /** Side panels start at the top of the window, not under the sub-tab strip. */
    async expectFullHeight(drawer) {
        const viewport = this.page.viewportSize();
        await expect
            .poll(async () => {
                const box = await drawer.boundingBox();
                return box ? Math.round(box.y) <= 1 && box.height >= viewport.height - 2 : false;
            }, { timeout: 5000 })
            .toBe(true);
    }


    retentionCell(cohort, k) {
        return this.page.locator(`[data-test="rum-analytics-retention-cell-${cohort}-${k}"]`);
    }

    async retentionPct(cohort, k) {
        const text = (await this.retentionCell(cohort, k).innerText()).trim();
        return Number(text.replace(/[~%\s]/g, ''));
    }


    /** Opens the Named events sub-tab and waits for its list. */
    async openNamedEvents() {
        await this.openSubTab('events');
        await expect(this.namedEventsList).toBeVisible({ timeout: 20000 });
    }

    /** The name cells of the named events list; each carries `rum-analytics-named-events-row-<i>`. */
    namedEventNames() {
        return this.namedEventsList.locator('[data-test="o2-table-cell-name"] [data-test^="rum-analytics-named-events-row-"]');
    }

    /** The row id (`rum-analytics-named-events-row-<i>`) of the listed event with this name. */
    async namedEventRowId(name) {
        const cell = this.namedEventNames().filter({ hasText: name }).first();
        await expect(cell).toBeVisible({ timeout: 20000 });
        return cell.getAttribute('data-test');
    }

    /** Fills the open editor's name and first page rule. */
    async fillPageEvent(name, page) {
        await expect(this.eventEditor).toBeVisible({ timeout: 20000 });
        await this.page.locator('[data-test="rum-analytics-named-events-name-field"]').fill(name);
        await this.page.locator('[data-test="rum-analytics-named-events-rule-0-value-input"]').fill(page);
        await this.page.keyboard.press('Tab');
    }

    /** Creates a page event from the list's New event and lands back on the list. */
    async createPageEvent(name, page) {
        await this.openNamedEvents();
        await this.newEventBtn.click();
        await this.fillPageEvent(name, page);
        await this.eventSaveBtn.click();
        await expect(this.namedEventsList).toBeVisible({ timeout: 20000 });
        await expect(this.namedEventNames().filter({ hasText: name }).first()).toBeVisible({ timeout: 20000 });
    }

    /** Deletes a listed event through its row action; the list must be open. */
    async deleteNamedEvent(name) {
        const id = await this.namedEventRowId(name);
        await this.page.locator(`[data-test="${id}-delete-btn"]`).click();
        await this.page.locator('[data-test="o-dialog-primary-btn"]').click();
        await expect(this.namedEventNames().filter({ hasText: name })).toHaveCount(0, { timeout: 20000 });
    }


    /** Saves the funnel on screen: Save on an unsaved funnel, or a menu action that opens the name dialog. */
    async saveFunnel(name, action = null) {
        if (action) {
            await this.page.locator('[data-test="rum-analytics-funnel-saved-menu-btn"]').click();
            await this.page.locator(`[data-test="rum-analytics-funnel-saved-menu-${action}"]`).click();
        } else {
            await this.page.locator('[data-test="rum-analytics-funnel-save-btn"]').click();
        }
        const dialog = this.page.locator('[data-test="rum-analytics-save-funnel-dialog"]');
        if (name !== null) await dialog.locator('[data-test="rum-analytics-save-funnel-name-field"]').fill(name);
        await dialog.locator('[data-test="o-dialog-primary-btn"]').click();
        await expect(dialog).toBeHidden({ timeout: 20000 });
    }

    /** Shows the saved-funnels list page: Back from the builder, or the Funnels sub-tab from anywhere else. */
    async openSavedFunnels() {
        const list = this.page.locator('[data-test="rum-analytics-saved-funnels-page"]');
        if (!(await list.isVisible())) {
            const back = this.page.locator('[data-test="rum-analytics-funnel-back-btn"]');
            if (await back.isVisible()) await back.click();
            else await this.subTab('funnels').click();
        }
        await expect(this.page).toHaveURL(/\/product-analytics\/funnels(\?|$)/);
        await expect(list).toBeVisible({ timeout: 20000 });
        return list;
    }

    /** Opens a saved funnel from the list page in the builder. */
    async openSavedFunnel(name) {
        await this.openSavedFunnels();
        await (await this.savedFunnelRow(name)).click();
        await expect(this.page).toHaveURL(/\/product-analytics\/funnels\/build/);
        await expect(this.page.locator('[data-test="rum-analytics-funnel-saved-name"]')).toHaveText(name);
    }

    /** Opens an empty, unsaved funnel in the builder from the list page's New funnel. */
    async newFunnel() {
        await this.openSavedFunnels();
        await this.page.locator('[data-test="rum-analytics-saved-funnels-new-btn"]').click();
        await expect(this.page).toHaveURL(/\/product-analytics\/funnels\/build/);
        await expect(this.funnelCold).toBeVisible({ timeout: 30000 });
    }

    /** The name cell of a saved-funnels list row, matched exactly; the list page must be open. */
    async savedFunnelRow(name) {
        const exact = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
        const named = this.page
            .locator('[data-test="rum-analytics-saved-funnels-page"] [data-test^="rum-analytics-saved-funnel-row-"]')
            .filter({ hasText: exact })
            .first();
        await expect(named).toBeVisible({ timeout: 20000 });
        return named;
    }

    async savedFunnelRowAction(name, action) {
        await this.openSavedFunnels();
        const id = await (await this.savedFunnelRow(name)).getAttribute('data-test');
        await this.page.locator(`[data-test="${id}-${action}"]`).click();
    }

    /** Waits for the next named-event or funnel write and returns its JSON row. */
    waitForAnalyticsWrite(kind, method = 'POST') {
        const path = kind === 'event' ? 'named_events' : 'funnels';
        return this.page
            .waitForResponse((r) => r.request().method() === method && new RegExp(`/api/[^/]+/rum/analytics/${path}(/[0-9A-Za-z]{27})?\\?`).test(r.url()))
            .then(async (r) => ({ status: r.status(), body: await r.json().catch(() => null) }));
    }

    /** WCAG contrast of an element's text against its nearest opaque background. */
    async contrastOf(locator) {
        return locator.evaluate((el) => {
            const parse = (c) => {
                const m = c.match(/rgba?\(([^)]+)\)/);
                if (!m) return null;
                const [r, g, b, a = '1'] = m[1].split(/[ ,/]+/).filter(Boolean);
                return { r: +r, g: +g, b: +b, a: +a };
            };
            const lum = ({ r, g, b }) => {
                const f = (v) => {
                    const s = v / 255;
                    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
                };
                return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
            };
            const fg = parse(getComputedStyle(el).color);
            let node = el;
            let bg = null;
            while (node) {
                const c = parse(getComputedStyle(node).backgroundColor);
                if (c && c.a > 0.5) {
                    bg = c;
                    break;
                }
                node = node.parentElement;
            }
            bg = bg || { r: 255, g: 255, b: 255, a: 1 };
            const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
            return (hi + 0.05) / (lo + 0.05);
        });
    }
}
