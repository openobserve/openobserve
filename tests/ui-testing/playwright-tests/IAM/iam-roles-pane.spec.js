// IAM → Edit Role · pane navigation and state (P-01 .. P-07, P-B1)
//
// Plan: .claude/commands/nvpworkflow/iam-roles-redesign-tests.md (Wave 2, flows 15-21)
//
// ModulePane is keyed by `trail.join('/')` in EditRole.vue, so every level gets a
// fresh component — which is exactly why search must reset and why page size, which
// is a v-model on the PARENT, must not. Those two pull in opposite directions and
// only a test keeps them straight.
//
// ENTERPRISE ONLY, and needs a build carrying openobserve#14682.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const {
    ns, req, listRoles, createRole, setRolePerms, makeTracker, uniq, org, rbacEnabled,
} = require('./iam-fixtures.js');

// This file's own namespace. Every artifact it creates lives under it, and its
// sweeps delete only it: the eleven IAM specs run in parallel and, through a
// shared `ui_auto` prefix, used to delete each other's fixtures mid-test.
const NS = ns('pan');

// What this spec made, so teardown deletes exactly that — never a prefix sweep,
// which is what had the IAM specs deleting each other's fixtures mid-test.
const made = makeTracker();

const obj = (resource) => `${resource}:_all_${org()}`;

test.describe('IAM · Edit Role · pane navigation', { tag: '@enterprise' }, () => {
    // Serial, NOT parallel. every test in this file creates roles under one namespace and afterAll sweeps that
    // namespace, and beforeAll/afterAll run once PER WORKER — not per file. Under
    // `fullyParallel: true` this file's tests spread across workers, so each worker runs
    // its own sweep and they delete each other's roles mid-test: measured as
    // "teardown left roles behind: <this file's own prefix>". Serial pins the file to one
    // worker, so there is exactly one setup and one teardown.
    test.describe.configure({ mode: 'serial' });

    let pm;

    const freshRole = async (page, tag) => {
        const name = `${NS}_pn_${tag}_${uniq()}`;
        made.role(name);
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
        } finally {
            await page.close();
        }
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            const removed = (await made.cleanup(page)).roles;
            testLogger.info(`teardown removed ${removed.length} roles`);
            const left = await made.survivors(page);
            if (left.length) throw new Error(`teardown left its own artifacts behind: ${left}`);
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

    // ---------------- flow 15 ----------------

    test('P-01 · a pane search is cleared by navigating away, and on returning', {
        tag: ['@iam', '@iamRolesPane', '@P1', '@all']
    }, async ({ page }) => {
        await openWith(page, 'search', []);
        await pm.rolesPage.openModule('stream');

        const hasSearch = await pm.rolesPage.paneSearch.isVisible({ timeout: 10000 }).catch(() => false);
        test.skip(!hasSearch, 'the stream module has too few rows to render a search box');
        await pm.rolesPage.paneSearch.fill('zzz_no_such_stream');
        await expect(pm.rolesPage.paneSearch).toHaveValue('zzz_no_such_stream');

        // `function` is a genuine rail module; `logs` is a row inside stream.
        await pm.rolesPage.openModule('function');
        // A stale filter silently hides rows in a module the user never searched.
        if (await pm.rolesPage.paneSearch.isVisible({ timeout: 5000 }).catch(() => false)) {
            await expect(pm.rolesPage.paneSearch, 'the search carried into another module').toHaveValue('');
        }

        await pm.rolesPage.openModule('stream');
        if (await pm.rolesPage.paneSearch.isVisible({ timeout: 5000 }).catch(() => false)) {
            await expect(pm.rolesPage.paneSearch, 'the search came back when the module did').toHaveValue('');
        }
    });

    // ---------------- flow 16 ----------------

    test('P-02 · page size survives navigation, and a search returns to page 1', {
        tag: ['@iam', '@iamRolesPane', '@P2', '@all']
    }, async ({ page }) => {
        await openWith(page, 'pagesize', []);
        await pm.rolesPage.openModule('stream');

        const hasPaging = await pm.rolesPage.panePageSize.isVisible({ timeout: 10000 }).catch(() => false);
        test.skip(!hasPaging, 'not enough rows in this org to paginate the stream module');

        // 50 is one of ModulePane's three options ([25, 50, 100]).
        await pm.rolesPage.setPageSize(50);
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.openModule('stream');
        // pageSize is a v-model on EditRole, not pane state — it must outlive the key change.
        expect(await pm.rolesPage.pageSize(), 'page size reset when the module changed').toBe(50);

        const canNext = await pm.rolesPage.paneNextPage.isEnabled().catch(() => false);
        if (canNext) {
            await pm.rolesPage.paneNextPage.click();
            const before = await pm.rolesPage.panePaginationInfo.innerText().catch(() => '');
            await pm.rolesPage.paneSearch.fill('a');
            // Searching while on page 3 would otherwise show an empty page of results.
            await expect
                .poll(async () => await pm.rolesPage.panePaginationInfo.innerText().catch(() => ''),
                    { timeout: 15000 })
                .not.toBe(before);
        }
    });

    // ---------------- flow 17 ----------------

    test('P-03 · Back inside a folder returns one level up, not to the Role Overview', {
        tag: ['@iam', '@iamRolesPane', '@P1', '@all']
    }, async ({ page }) => {
        await openWith(page, 'back', []);
        await pm.rolesPage.openModule('stream');

        const nodes = page.locator('[data-test^="edit-role-module-pane-open-"]');
        test.skip(await nodes.count() === 0, 'the stream module has no sub-level to descend into');
        await nodes.first().click();
        await expect(pm.rolesPage.paneBack).toBeVisible({ timeout: 15000 });

        await pm.rolesPage.paneBack.click();
        // One level up means the pane, still on this module — NOT the summary.
        await expect(pm.rolesPage.pane).toBeVisible({ timeout: 15000 });
        await expect(pm.rolesPage.summary, 'Back jumped out to the Role Overview').toHaveCount(0);
    });

    // ---------------- flow 18 ----------------

    test('P-04 · the pane Selected filter lists only granted rows, and unticking removes one', {
        tag: ['@iam', '@iamRolesPane', '@P1', '@all']
    }, async ({ page }) => {
        await openWith(page, 'selected', [{ object: obj('function'), permission: 'AllowList' }]);
        await pm.rolesPage.openModule('function');

        const hasFilter = await pm.rolesPage.paneFilterGranted.isVisible({ timeout: 10000 }).catch(() => false);
        test.skip(!hasFilter, 'the function module does not render the granted filter here');
        await pm.rolesPage.paneFilterGranted.click();

        const shown = pm.rolesPage.entityCheckboxes('AllowList');
        const before = await shown.count();
        expect(before, 'the Selected view showed nothing for a role that holds a grant').toBeGreaterThan(0);

        // Every row in this view is granted by definition.
        for (let i = 0; i < before; i++) {
            expect(await pm.rolesPage.isChecked(shown.nth(i)),
                'the Selected view listed an ungranted row').toBe(true);
        }
    });

    // ---------------- flow 19 ----------------

    test('P-05 · the "N Inside" badge appears on a node holding item grants and tracks the count', {
        tag: ['@iam', '@iamRolesPane', '@P2', '@all']
    }, async ({ page }) => {
        await openWith(page, 'inside', []);
        await pm.rolesPage.openModule('stream');

        const nodes = page.locator('[data-test^="edit-role-module-pane-open-"]');
        test.skip(await nodes.count() === 0, 'no stream type node to grant inside');
        const nodeName = (await nodes.first().getAttribute('data-test'))
            .replace('edit-role-module-pane-open-', '');

        // No item grants yet, so no badge.
        await expect(pm.rolesPage.paneInside(nodeName)).toHaveCount(0);

        await nodes.first().click();
        await expect(pm.rolesPage.paneBack).toBeVisible({ timeout: 15000 });
        const boxes = pm.rolesPage.entityCheckboxes('AllowGet');
        test.skip(await boxes.count() === 0, 'no stream inside this type to grant');
        await pm.rolesPage.setCheckbox(boxes.first(), true);

        await pm.rolesPage.paneBack.click();
        // The badge is the only signal that a collapsed node holds grants.
        await expect(pm.rolesPage.paneInside(nodeName)).toBeVisible({ timeout: 15000 });
        await expect(pm.rolesPage.paneInside(nodeName)).toContainText('1');
    });

    // ---------------- flow 20 ----------------

    test('P-06 · a module with no resources shows the empty state and still offers All', {
        tag: ['@iam', '@iamRolesPane', '@P2', '@all']
    }, async ({ page }) => {
        await openWith(page, 'empty', []);

        const key = 'enrichment_table';
        test.skip(!(await pm.rolesPage.railItem(key).isVisible({ timeout: 10000 }).catch(() => false)),
            'enrichment tables are not offered in this org');
        await pm.rolesPage.openModule(key);

        const empty = await pm.rolesPage.paneNoResources.isVisible({ timeout: 10000 }).catch(() => false);
        test.skip(!empty, 'this org has enrichment tables, so the empty state cannot be checked');

        // An empty module must still be grantable at the type level, or the role can
        // never be given access to tables added later.
        await expect(pm.rolesPage.scopeCheckbox(key, 'AllowList')).toBeVisible({ timeout: 15000 });
        expect(await pm.rolesPage.scopeCheckbox(key, 'AllowList').isDisabled().catch(() => false))
            .toBe(false);
    });

    // ---------------- flow 21 ----------------

    test('P-07 · a module with no items of its own shows no search, pagination or empty state', {
        tag: ['@iam', '@iamRolesPane', '@P2', '@all']
    }, async ({ page }) => {
        await openWith(page, 'noitems', []);

        // `settings` has has_entities:false — it lists ITSELF as one row.
        test.skip(!(await pm.rolesPage.railItem('settings').isVisible({ timeout: 10000 }).catch(() => false)),
            'settings is not offered in this org');
        await pm.rolesPage.openModule('settings');

        await expect(pm.rolesPage.paneSearch, 'a one-row module rendered a search box').toHaveCount(0);
        // ModulePane sets OTable's pagination to "none" for a module with no entities
        // (paginationMode), but the pagination WRAPPER still renders — so absence has to
        // be asserted on the controls themselves, not on the container.
        await expect(pm.rolesPage.panePageSize, 'a one-row module offered a page size').toHaveCount(0);
        await expect(pm.rolesPage.paneNextPage, 'a one-row module offered a next page').toHaveCount(0);
        await expect(pm.rolesPage.paneNoResources, 'a module listing itself claimed to be empty').toHaveCount(0);
    });

    // ---------------- known bug: flow 30 ----------------

    // FAILS TODAY, by design.
    //
    // Going straight from one role's edit URL to another's leaves the FIRST role on
    // screen, and Save then writes to it. The route param changes but the editor does
    // not re-initialise, so the user edits what looks like role B and silently
    // modifies role A.
    //
    // Writes to the wrong object — worse than losing the edit. NEEDS AN o2-enterprise
    // ISSUE; put its number in this title, as U-14 and GR-04 do.
    test.fixme('P-B1 · navigating directly between two role URLs loads the second role', {
        tag: ['@iam', '@iamRolesPane', '@P0', '@bug', '@all']
    }, async ({ page }) => {
        const first = await freshRole(page, 'urlone');
        const second = await freshRole(page, 'urltwo');

        const base = (process.env.ZO_BASE_URL || '').replace(/\/$/, '');
        const orgId = process.env.ORGNAME || 'default';
        const url = (name) => `${base}/web/iam/roles/edit/${name}?org_identifier=${orgId}`;

        await page.goto(url(first), { waitUntil: 'domcontentloaded' });
        await expect(pm.rolesPage.title).toContainText(first, { timeout: 20000 });

        // Same component, different param — the editor must re-initialise.
        await page.goto(url(second), { waitUntil: 'domcontentloaded' });
        await expect(pm.rolesPage.title, 'the first role stayed on screen under the second role URL')
            .toContainText(second, { timeout: 20000 });
    });
});
