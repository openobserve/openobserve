import { expect } from '@playwright/test';

/**
 * DesignTokenPage — component-level assertions for the design-token migration.
 *
 * Holds every selector + assertion the designTokenConsistency.spec.js needs so no
 * raw `page.locator`/`expect(page.locator(...))` leaks into the spec. It proves the
 * *runtime* facts of the token layer: OButton/OTable/OSelect token utility classes,
 * stable `data-*` identity hooks, and the absence of raw-palette ramp classes.
 */
export class DesignTokenPage {
    constructor(page) {
        this.page = page;

        // OButton identity markers. OButton has no hardcoded data-test — its stable
        // identity is `data-o2-btn` (bare attribute → renders as "") + `data-o2-variant`.
        this.primaryButton = page.locator('[data-o2-btn][data-o2-variant="primary"]');

        // OTable chrome / slug matrix. These are the stable, always-rendered slugs
        // (hardcoded in OTable.vue / OTableHeader.vue) — unlike `o2-table-root`, which
        // the consumer's forwarded `data-test` can override via attribute inheritance.
        this.tableElement = page.locator('[data-test="o2-table"]');
        this.tableHeader = page.locator('[data-test="o2-table-header"]');
        // Data-column header cells only: scoped to `th` (so the sort/remove *buttons*
        // with o2-table-th-*-prefixed data-tests never match) and excluding the special
        // select/expand/drag ths — those do NOT carry text-table-header-text.
        this.tableHeaderCells = page.locator(
          'th[data-test^="o2-table-th-"]:not([data-test="o2-table-th-select"]):not([data-test="o2-table-th-expand"]):not([data-test="o2-table-th-drag"])'
        );
    }

    // ==================== OButton token assertions ====================

    /**
     * Asserts the first primary OButton carries token-based variant utilities
     * (`bg-button-primary`, `text-button-primary-foreground`), the stable
     * `data-o2-btn` / `data-o2-variant="primary"` hooks, and does NOT emit raw
     * ramp classes (`bg-primary-*` / `bg-gray-*`).
     */
    async expectPrimaryButtonTokenClasses() {
        const primary = this.primaryButton.first();
        await expect(primary).toBeVisible({ timeout: 15000 });

        // Stable identity hooks
        await expect(primary).toHaveAttribute('data-o2-btn', '');
        await expect(primary).toHaveAttribute('data-o2-variant', 'primary');

        // Token utilities present (exact token membership) + raw ramp classes absent.
        const classList = ((await primary.getAttribute('class')) || '').split(/\s+/);
        expect(classList).toContain('bg-button-primary');
        expect(classList).toContain('text-button-primary-foreground');
        expect(classList.join(' ')).not.toMatch(/bg-(primary|gray)-\d+/);
    }

    /**
     * Computed background-color of the first primary OButton — resolves from the
     * `--color-button-primary` component token (returns e.g. `rgb(63, 121, 148)`).
     */
    async getPrimaryButtonBackground() {
        const primary = this.primaryButton.first();
        await expect(primary).toBeVisible({ timeout: 15000 });
        return await primary.evaluate((el) => getComputedStyle(el).backgroundColor);
    }

    /**
     * Asserts the first primary OButton's computed background-color IS the resolved
     * `--color-button-primary` token value — the causal linkage the test name
     * promises. The token is resolved through the browser's own cascade (a probe
     * element painted `var(--color-button-primary)`) rather than a hardcoded brand
     * hex, because a custom theme may override `--color-primary-*` inline
     * (`theme.ts`), and only the browser's cascade knows the *effective* value.
     */
    async expectPrimaryButtonBackgroundResolvesFromToken() {
        const primary = this.primaryButton.first();
        await expect(primary).toBeVisible({ timeout: 15000 });

        // The button's computed background-color (always a concrete rgb()/rgba()).
        const background = await primary.evaluate((el) => getComputedStyle(el).backgroundColor);

        // Probe: an element painted with the component token resolves it through
        // the same cascade + theme as the button. getComputedStyle resolves
        // background-color even for a non-displayed element, so this yields the
        // token's concrete color without hardcoding any hex value.
        const probeBackground = await this.page.evaluate(() => {
            const probe = document.createElement('span');
            probe.style.backgroundColor = 'var(--color-button-primary)';
            probe.style.position = 'absolute';
            probe.style.visibility = 'hidden';
            document.body.appendChild(probe);
            const color = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return color;
        });

        // Both must resolve to a concrete rgb()/rgba() color…
        expect(background).toMatch(/^rgba?\(/);
        expect(probeBackground).toMatch(/^rgba?\(/);
        // …and they must be equal: the button's background IS the token's color.
        expect(background).toBe(probeBackground);
    }

    // ==================== OTable chrome assertions ====================

    /**
     * Asserts the OTable mounted (inner `o2-table`) and its header chrome uses token
     * classes. Source-verified: the `<thead data-test="o2-table-header">` carries
     * `bg-table-header-bg`, while each column `<th data-test^="o2-table-th-">` carries
     * `text-table-header-text` (`bg-table-header-bg` is only on the th when the column
     * is pinned — so the header background is asserted on the thead, not the th).
     */
    async expectTableChrome() {
        await expect(this.tableElement).toBeVisible({ timeout: 15000 });

        // Header background lives on the <thead>, not each <th>.
        const header = this.tableHeader.first();
        await expect(header).toBeVisible();
        await expect(header).toHaveClass(/bg-table-header-bg/);

        // Header text color lives on each column <th>.
        const headerCell = this.tableHeaderCells.first();
        await expect(headerCell).toBeVisible();
        await expect(headerCell).toHaveClass(/text-table-header-text/);
    }

    // ==================== OSelect derived-slug assertions ====================

    getSelectTrigger(parentTest) {
        return this.page.locator(`[data-test="${parentTest}-trigger"]`);
    }

    getSelectPopover(parentTest) {
        return this.page.locator(`[data-test="${parentTest}-popover"]`);
    }

    /**
     * Asserts an OSelect derived its child slugs from the parent `data-test`
     * (`<parent>-trigger` / `<parent>-popover`) and renders token chrome
     * (`bg-select-content-bg` on the popover content).
     */
    async expectSelectChrome(parentTest) {
        const trigger = this.getSelectTrigger(parentTest);
        await expect(trigger).toBeVisible({ timeout: 15000 });

        // Open the select so the popover mounts.
        await trigger.click();
        const popover = this.getSelectPopover(parentTest);
        await expect(popover).toBeVisible({ timeout: 10000 });
        await expect(popover).toHaveClass(/bg-select-content-bg/);
    }

    // ==================== Sticky-column shadow token assertions ====================

    /**
     * Asserts the sticky-column shadow tokens (`--shadow-sticky-left/right/footer`)
     * resolve to non-empty shadow strings. These are semantic tokens on <html>;
     * their *consumption* (useStickyColumns inside a pivot table with sticky
     * columns) is data-gated, so this assertion lives in a test.fixme until pivot
     * data is in scope — but the resolution assertion is real and goes green the
     * moment the fixme lifts.
     */
    async expectStickyShadowTokensResolve() {
        const tokens = await this.page.evaluate(() => {
            const styles = getComputedStyle(document.documentElement);
            const read = (name) => styles.getPropertyValue(name).trim();
            return {
                left: read('--shadow-sticky-left'),
                right: read('--shadow-sticky-right'),
                footer: read('--shadow-sticky-footer'),
            };
        });
        for (const [key, value] of Object.entries(tokens)) {
            expect(value.length, `${key} should resolve non-empty`).toBeGreaterThan(0);
        }
    }
}
