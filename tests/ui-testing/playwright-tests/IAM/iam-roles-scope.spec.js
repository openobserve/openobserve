// IAM → Edit Role · wider-scope interaction (W-01 .. W-03)
//
// Plan: .claude/commands/nvpworkflow/iam-roles-redesign-tests.md (Wave 2, flows 12-14)
//
// A wider grant LOCKS the rows it already covers — the redesign's visible promise.
// What the grants spec does not cover is what happens when a wider grant and an
// item's own grant coexist, and what happens to a locked box once the wider grant is
// staged for removal. Both are places where the UI can quietly lose a grant the user
// never touched.
//
// ENTERPRISE ONLY, and needs a build carrying openobserve#14682.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const {
    PREFIX, req, listRoles, createRole, setRolePerms, getPerms, sweepRoles, uniq, org, rbacEnabled,
} = require('./iam-fixtures.js');

const obj = (resource) => `${resource}:_all_${org()}`;

const S_ONE = `${PREFIX}_w_s_one`;

test.describe('IAM · Edit Role · wider scope', { tag: '@enterprise' }, () => {
    let pm;

    const freshRole = async (page, tag) => {
        const name = `${PREFIX}_sc_${tag}_${uniq()}`;
        await createRole(page, name);
        return name;
    };

    const openWith = async (page, tag, perms) => {
        const name = await freshRole(page, tag);
        if (perms?.length) await setRolePerms(page, name, perms);
        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.openRole(name);
        await pm.rolesPage.waitForGrantsSettled(perms?.length ?? 0);
        return name;
    };

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await sweepRoles(page);
            await req(page, 'POST', `/${S_ONE}/_json`, [
                { _timestamp: Date.now() * 1000, level: 'info', msg: 'scope seed' },
            ]);
            await expect
                .poll(async () => (await req(page, 'GET', `/streams/${S_ONE}/schema?type=logs`)).status,
                    { timeout: 30000, intervals: [500, 1000, 2000] })
                .toBeLessThan(400);
            testLogger.info('scope fixtures ready');
        } finally {
            await page.close();
        }
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await req(page, 'DELETE', `/streams/${S_ONE}?type=logs`).catch(() => {});
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

    // ---------------- flow 12 ----------------

    test('W-01 · unticking a type-level grant keeps an item grant and unlocks the rest', {
        tag: ['@iam', '@iamRolesScope', '@P1', '@all']
    }, async ({ page }) => {
        // The role holds BOTH the whole logs type and one stream in its own right.
        const name = await openWith(page, 'both', [
            { object: obj('logs'), permission: 'AllowGet' },
            { object: `logs:${S_ONE}`, permission: 'AllowGet' },
        ]);

        // `logs` is a row inside the stream module, not a rail module of its own.
        await pm.rolesPage.openModule('stream');
        // While the type grant stands, the row it covers is locked.
        await expect(pm.rolesPage.scopeCheckbox('logs', 'AllowGet'))
            .toHaveAttribute('aria-checked', 'true', { timeout: 15000 });

        await pm.rolesPage.revokeScope('logs', 'AllowGet');

        const payload = await pm.rolesPage.saveAndCapture();
        // Only the wide grant goes. The stream's own grant was never the user's target.
        expect(payload.remove).toEqual([{ object: obj('logs'), permission: 'AllowGet' }]);
        expect(payload.add).toEqual([]);

        await expect
            .poll(async () => (await getPerms(page, name)).map((p) => p.object).sort(), { timeout: 15000 })
            .toEqual([`logs:${S_ONE}`]);
    });

    // ---------------- flow 13 ----------------

    test('W-02 · Every Stream locks the logs, metrics, traces and index rows', {
        tag: ['@iam', '@iamRolesScope', '@P1', '@all']
    }, async ({ page }) => {
        await openWith(page, 'every', [{ object: obj('stream'), permission: 'AllowAll' }]);
        await pm.rolesPage.openModule('stream');

        // All four stream types sit under "Every Stream"; each must read as covered
        // AND be refused direct edits, or the user can create a contradiction.
        for (const key of ['logs', 'metrics', 'traces', 'index']) {
            const box = pm.rolesPage.scopeCheckbox(key, 'AllowAll');
            if (!(await box.isVisible({ timeout: 5000 }).catch(() => false))) continue;
            await expect(box, `${key} is not shown as covered by Every Stream`)
                .toHaveAttribute('aria-checked', 'true', { timeout: 15000 });
            expect(await box.isDisabled().catch(() => false),
                `${key} stayed editable under an Every Stream AllowAll`).toBe(true);
        }
    });

    // ---------------- flow 14 ----------------

    test('W-03 · a box becomes editable once the grant locking it is staged for removal', {
        tag: ['@iam', '@iamRolesScope', '@P1', '@all']
    }, async ({ page }) => {
        await openWith(page, 'unlock', [{ object: obj('stream'), permission: 'AllowAll' }]);
        await pm.rolesPage.openModule('stream');

        const logs = pm.rolesPage.scopeCheckbox('logs', 'AllowAll');
        test.skip(!(await logs.isVisible({ timeout: 10000 }).catch(() => false)),
            'the logs row is not rendered under the stream module here');
        expect(await logs.isDisabled().catch(() => false),
            'the row was not locked to begin with, so this proves nothing').toBe(true);

        // Stage the wider grant's removal; the lock it imposed must lift immediately,
        // without a save — otherwise the user cannot express "not all, just these".
        await pm.rolesPage.revokeScope('stream', 'AllowAll');
        await expect.poll(async () => await logs.isDisabled().catch(() => true), { timeout: 15000 })
            .toBe(false);
    });
});
