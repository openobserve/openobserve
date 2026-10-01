// IAM → Edit Role · scale and layout (SC-01 .. SC-03)
//
// Plan: .claude/commands/nvpworkflow/iam-roles-redesign-tests.md (Wave 2, flows 25-27)
//
// The redesign exists because the old recursive tree hung on a role with thousands of
// grants. U-12 guards the module pane's first paint; these guard the two things it
// does not: a role that ALREADY holds a thousand grants has to open at all, and the
// Table -> JSON -> Table round trip must be lossless at that size.
//
// Grants are seeded through the API, not the UI — ticking a thousand boxes would test
// Playwright, not the editor.
//
// ENTERPRISE ONLY, and needs a build carrying openobserve#14682.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const {
    PREFIX, req, listRoles, createRole, setRolePerms, getPerms, sweepRoles, uniq, org, rbacEnabled,
} = require('./iam-fixtures.js');

const obj = (resource) => `${resource}:_all_${org()}`;

// Enough to have broken the old tree, few enough to seed in one PUT.
const BULK = 1000;
const S_PREFIX = `${PREFIX}_sc_s`;

// A role holding grants across many shapes at once, for the JSON round trip.
const MIXED_RESOURCES = [
    'function', 'pipeline', 'template', 'destination', 'enrichment_table',
    'settings', 'dfolder', 'afolder', 'rfolder', 'stream', 'logs',
];

test.describe('IAM · Edit Role · scale and layout', { tag: '@enterprise' }, () => {
    let pm;

    const freshRole = async (page, tag) => {
        const name = `${PREFIX}_sl_${tag}_${uniq()}`;
        await createRole(page, name);
        return name;
    };

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await sweepRoles(page);
        } finally {
            await page.close();
        }
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            const removed = await sweepRoles(page);
            testLogger.info(`teardown removed ${removed.length} roles`);
            const left = (await listRoles(page)).filter((r) => r.startsWith(PREFIX));
            if (left.length) throw new Error(`teardown left roles behind: ${left}`);
        } finally {
            await page.close();
        }
    });

    test.beforeEach(async ({ page }) => {
        await navigateToBase(page);
        pm = new PageManager(page);
        test.skip(!(await rbacEnabled(page)), 'RBAC is off (OSS build)');
        await page.locator('[data-test="menu-link-\\/iam-item"]').click();
        await pm.rolesPage.rolesTab.waitFor({ state: 'visible', timeout: 30000 });
    });

    // ---------------- flow 25 ----------------

    test('SC-01 · a role with 1,000 stream grants opens, counts them, and stays usable', {
        tag: ['@iam', '@iamRolesScale', '@P1', '@slow', '@all']
    }, async ({ page }) => {
        const name = await freshRole(page, 'bulk');

        // The grants need no real streams behind them: the editor renders what the
        // role HOLDS, and inventing 1,000 streams would be a far slower test.
        const grants = Array.from({ length: BULK }, (_, i) => ({
            object: `logs:${S_PREFIX}_${i}`,
            permission: 'AllowGet',
        }));
        const put = await setRolePerms(page, name, grants);
        test.skip(put.status >= 400, `the API refused a ${BULK}-grant role: ${put.status}`);
        await expect
            .poll(async () => (await getPerms(page, name)).length, { timeout: 60000 })
            .toBe(BULK);

        const started = Date.now();
        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.openRole(name);
        // The counter must reach the real number, not stall on the "—" placeholder
        // and not flash a real 0 (o2-enterprise#2697).
        await pm.rolesPage.waitForGrantsSettled(BULK);
        const elapsed = Date.now() - started;

        // A hard budget is the only thing standing between the old hang returning and
        // nobody noticing.
        expect(elapsed, `opening a ${BULK}-grant role took ${elapsed}ms`).toBeLessThan(60000);

        // "Opened" is not "usable": the rail must still navigate afterwards.
        await pm.rolesPage.openModule('stream');
        await expect(pm.rolesPage.pane).toBeVisible({ timeout: 30000 });
        await pm.rolesPage.openSummary({ timeout: 30000 });
    });

    // ---------------- flow 26 ----------------

    test('SC-02 · Table to JSON and back leaves the count unchanged and stages nothing', {
        tag: ['@iam', '@iamRolesScale', '@P1', '@all']
    }, async ({ page }) => {
        const name = await freshRole(page, 'roundtrip');

        // Many shapes at once, because the round trip has to re-serialise each kind —
        // folder-scoped, flat, stream-typed and _all_ — and a single shape would hide
        // a loss in the others.
        const grants = MIXED_RESOURCES.map((r) => ({ object: obj(r), permission: 'AllowList' }));
        const put = await setRolePerms(page, name, grants);
        test.skip(put.status >= 400, `the API refused the mixed role: ${put.status}`);
        const stored = (await getPerms(page, name)).length;
        expect(stored, 'the mixed fixture stored nothing').toBeGreaterThan(0);

        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.openRole(name);
        await pm.rolesPage.waitForGrantsSettled(stored);

        await pm.rolesPage.showJsonButton.click();
        await expect(pm.rolesPage.permissionsCount).toContainText(String(stored), { timeout: 30000 });

        await pm.rolesPage.showTableButton.click();
        await expect(pm.rolesPage.permissionsCount).toContainText(String(stored), { timeout: 30000 });

        // Looking at the JSON is not editing it — a round trip that stages changes
        // would let an untouched role be rewritten by a stray Save.
        await expect(pm.rolesPage.reviewChangesButton,
            'the Table -> JSON -> Table round trip staged changes').toHaveCount(0);

        const payload = await pm.rolesPage.saveAndCapture({ expectRequest: false });
        if (payload) {
            expect(payload.add, 'the round trip sent additions').toEqual([]);
            expect(payload.remove, 'the round trip sent removals').toEqual([]);
        }
        await expect
            .poll(async () => (await getPerms(page, name)).length, { timeout: 15000 })
            .toBe(stored);
    });

    // ---------------- flow 27 ----------------

    test('SC-03 · the rail runs to the bottom of the page, and survives phone width', {
        tag: ['@iam', '@iamRolesScale', '@P2', '@all']
    }, async ({ page }) => {
        const name = await freshRole(page, 'layout');
        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.openRole(name);
        await pm.rolesPage.waitForGrantsSettled(0);

        const rail = await pm.rolesPage.rail.boundingBox();
        const save = await pm.rolesPage.saveButton.boundingBox();
        expect(rail, 'the module rail did not render').toBeTruthy();
        expect(save, 'the Save button did not render').toBeTruthy();

        // The rail must reach down to the action row rather than stopping short and
        // leaving dead space — the layout complaint the redesign set out to fix.
        const railBottom = rail.y + rail.height;
        const saveTop = save.y;
        expect(
            Math.abs(railBottom - (saveTop + save.height)) < 200 || railBottom > saveTop,
            `rail bottom ${railBottom} is far above the action row at ${saveTop}`,
        ).toBe(true);

        // Phone width: the rail may collapse, but the editor must stay operable.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(1500);
        await expect(pm.rolesPage.permissionsSection).toBeVisible({ timeout: 15000 });
        const item = pm.rolesPage.railItem('function');
        if (await item.isVisible({ timeout: 5000 }).catch(() => false)) {
            await pm.rolesPage.openModule('function');
            await expect(pm.rolesPage.pane).toBeVisible({ timeout: 15000 });
        }
        await page.setViewportSize({ width: 1280, height: 800 });
    });
});
