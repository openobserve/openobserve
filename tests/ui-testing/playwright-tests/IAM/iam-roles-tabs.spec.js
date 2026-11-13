// IAM → Edit Role · tabs and leaving the page (T-01 .. T-04, T-B1)
// IAM → Roles list · member counts that open the matching tab (MC-01 .. MC-04, openobserve#16543)
//
// Plan: .claude/commands/nvpworkflow/iam-roles-redesign-tests.md (Wave 2, flows 22-24)
//
// The editor saves permissions, users and service accounts from one Save button, so
// the interesting questions are whether ONE request carries all of it and whether the
// per-tab unsaved dot tells the truth about which tab is dirty. A dot on the wrong tab
// sends the user looking in the wrong place; a second request means a partial save is
// possible.
//
// ENTERPRISE ONLY, and needs a build carrying openobserve#14682.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const { openNavFlyoutChild } = require('../../pages/commonActions.js');
const testLogger = require('../utils/test-logger.js');
const {
    ns, req, listRoles, listUsers, createRole, getPerms, makeTracker,
    uniq, uniqueEmail, org, rbacEnabled,
    createMember, createServiceAccount, addRoleMembers, listMemberRoles,
} = require('./iam-fixtures.js');

// This file's own namespace. Every artifact it creates lives under it, and its
// sweeps delete only it: the eleven IAM specs run in parallel and, through a
// shared `ui_auto` prefix, used to delete each other's fixtures mid-test.
const NS = ns('tab');

// What this spec made, so teardown deletes exactly that — never a prefix sweep,
// which is what had the IAM specs deleting each other's fixtures mid-test.
const made = makeTracker();

const obj = (resource) => `${resource}:_all_${org()}`;

const U_MEMBER = `${NS}_t_member@example.com`;

test.describe('IAM · Edit Role · tabs and leaving', { tag: '@enterprise' }, () => {
    // Serial, NOT parallel. U_MEMBER is made once in beforeAll and T-01 assigns it.
    // `fullyParallel: true` races individual TESTS, so the per-file namespaces in
    // iam-fixtures.js only stop files colliding — this stops a file colliding with
    // itself. Cost: a failure here skips the rest of the file rather than running them.
    test.describe.configure({ mode: 'serial' });

    let pm;

    const freshRole = async (page, tag) => {
        const name = `${NS}_tb_${tag}_${uniq()}`;
        made.role(name);
        await createRole(page, name);
        return name;
    };

    const openFresh = async (page, tag) => {
        const name = await freshRole(page, tag);
        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.openRole(name);
        await pm.rolesPage.waitForGrantsSettled(0);
        return name;
    };

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await createMember(page, made.user(U_MEMBER), 'user', { firstName: 'Automation', lastName: 'TestUser' });
            testLogger.info('tabs fixtures ready');
        } finally {
            await page.close();
        }
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            const gone = await made.cleanup(page);
            const roles = gone.roles;
            const users = gone.users;
            testLogger.info(`teardown removed ${roles.length} roles, ${users.length} users`);
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
        await openNavFlyoutChild(page, 'iam');
        await pm.rolesPage.rolesTab.waitFor({ state: 'visible', timeout: 30000 });
    });

    // ---------------- flow 22 ----------------

    test('T-01 · a user and a grant added together save in ONE request, and both store', {
        tag: ['@iam', '@iamRolesTabs', '@P0', '@all']
    }, async ({ page }) => {
        const name = await openFresh(page, 'both');

        await pm.rolesPage.openModule('function');
        await pm.rolesPage.grantScope('function', 'AllowList');

        await pm.rolesPage.switchTab('users');
        const row = await pm.rolesPage.findUserMember(U_MEMBER);
        await expect(row, `the seeded member ${U_MEMBER} is not listed under All on the Users tab`)
            .toBeVisible({ timeout: 30000 });
        await pm.rolesPage.setCheckbox(row, true);

        // Count the PUTs, not just the last one: two requests mean a partial save is
        // reachable, which is how a role ends up with users but no permissions.
        const puts = [];
        const onReq = (r) => {
            if (r.method() === 'PUT' && /\/roles\/[^/]+$/.test(new URL(r.url()).pathname)) {
                puts.push(JSON.parse(r.postData() || '{}'));
            }
        };
        page.on('request', onReq);
        const put = await pm.rolesPage.saveAndWaitForPut(name);
        expect(put.ok(), `role PUT failed with ${put.status()}`).toBe(true);
        await pm.rolesPage.waitForSaveSettled();
        page.off('request', onReq);

        expect(puts, `expected one PUT carrying both, got ${puts.length}`).toHaveLength(1);
        expect(puts[0].add).toEqual([{ object: obj('function'), permission: 'AllowList' }]);
        expect(puts[0].add_users).toContain(U_MEMBER);

        await expect
            .poll(async () => (await getPerms(page, name)).length, { timeout: 15000 })
            .toBe(1);
        await expect
            .poll(async () => (await req(page, 'GET', `/roles/${name}/users`)).body, { timeout: 15000 })
            .toEqual(expect.arrayContaining([expect.stringContaining(U_MEMBER)]));
    });

    // ---------------- flow 23 ----------------

    test('T-02 · the unsaved dot appears only on the tab whose own data changed', {
        tag: ['@iam', '@iamRolesTabs', '@P1', '@all']
    }, async ({ page }) => {
        await openFresh(page, 'dot');

        // Clean to start with, or the rest proves nothing.
        await expect(pm.rolesPage.tabDirtyDot('permissions')).toHaveCount(0);
        await expect(pm.rolesPage.tabDirtyDot('users')).toHaveCount(0);

        await pm.rolesPage.openModule('function');
        await pm.rolesPage.grantScope('function', 'AllowList');

        await expect(pm.rolesPage.tabDirtyDot('permissions')).toBeVisible({ timeout: 15000 });
        // A dot on Users for a permissions edit sends the user hunting in the wrong tab.
        await expect(pm.rolesPage.tabDirtyDot('users'),
            'a permissions change marked the Users tab dirty').toHaveCount(0);
    });

    // ---------------- flow 24 ----------------

    test('T-03 · leaving with unsaved changes prompts, and confirming discards them', {
        tag: ['@iam', '@iamRolesTabs', '@P1', '@all']
    }, async ({ page }) => {
        const name = await openFresh(page, 'leave');
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.grantScope('function', 'AllowList');
        await expect(pm.rolesPage.unsavedCount).toContainText('1', { timeout: 15000 });

        // A sidebar link is an in-app route change, which is what onBeforeRouteLeave guards.
        await openNavFlyoutChild(page, 'iam');
        await expect(pm.rolesPage.leaveConfirm, 'leaving with staged changes did not prompt')
            .toBeVisible({ timeout: 15000 });

        await pm.rolesPage.leaveConfirmOk.click();
        // Discarded means discarded: nothing may reach the API.
        await page.waitForTimeout(2000);
        expect(await getPerms(page, name),
            'confirming the leave prompt saved the changes instead of dropping them').toEqual([]);
    });

    test('T-04 · cancelling the leave prompt keeps the staged changes on the page', {
        tag: ['@iam', '@iamRolesTabs', '@P1', '@all']
    }, async ({ page }) => {
        await openFresh(page, 'stay');
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.grantScope('function', 'AllowList');

        await openNavFlyoutChild(page, 'iam');
        await expect(pm.rolesPage.leaveConfirm).toBeVisible({ timeout: 15000 });
        await pm.rolesPage.leaveConfirmCancel.click();

        // Still on the editor, still dirty — a cancel that loses the work is worse
        // than no prompt at all.
        await expect(pm.rolesPage.permissionsSection).toBeVisible({ timeout: 15000 });
        await expect(pm.rolesPage.unsavedCount).toContainText('1', { timeout: 15000 });
    });

    // ---------------- known bug: flow 29 ----------------

    // FAILS TODAY, by design.
    //
    // Checkbox changes made WHILE a save is in flight are folded into the saved state
    // but never sent. The editor clears its staged set on save completion rather than
    // on save start, so anything ticked in between is marked saved and silently lost —
    // the UI then shows a grant the backend does not have.
    //
    // Silent data loss. NEEDS AN o2-enterprise ISSUE; put its number in this title,
    // as U-14 and GR-04 do.
    test.fixme('T-B1 · a change made during a save is either sent or left staged', {
        tag: ['@iam', '@iamRolesTabs', '@P0', '@bug', '@all']
    }, async ({ page }) => {
        const name = await openFresh(page, 'during');
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.grantScope('function', 'AllowList');

        // Hold the save open so there is a real window to edit inside.
        await page.route('**/api/*/roles/*', async (route) => {
            if (route.request().method() === 'PUT') {
                await new Promise((r) => setTimeout(r, 4000));
            }
            await route.continue();
        });

        await pm.rolesPage.saveButton.click();
        await pm.rolesPage.openModule('pipeline');
        await pm.rolesPage.grantScope('pipeline', 'AllowList');
        await page.waitForTimeout(8000);

        // Whatever the editor shows, the backend must agree. Either the pipeline grant
        // was sent (2 stored) or it is still staged for a second save — never "saved"
        // and absent.
        const stored = (await getPerms(page, name)).map((p) => p.object).sort();
        const staged = await pm.rolesPage.unsavedCount.innerText().catch(() => '0');
        const claimsClean = !/[1-9]/.test(staged);
        expect(
            stored.includes(obj('pipeline')) || !claimsClean,
            'the grant made during the save was marked saved but never sent',
        ).toBe(true);
    });
});

// ---------------- roles list member counts (openobserve#16543) ----------------

test.describe('IAM · Roles list · member counts', { tag: '@enterprise' }, () => {
    // Serial: the roles and members are made once in beforeAll and every test reads them.
    test.describe.configure({ mode: 'serial' });

    const counted = makeTracker();
    const ROLE_MIXED = `${NS}_mc_mixed_${uniq()}`;
    const ROLE_NO_SA = `${NS}_mc_nosa_${uniq()}`;
    const MIXED_USER = uniqueEmail(`${NS}_mc_user`);
    const NO_SA_USER = uniqueEmail(`${NS}_mc_user`);
    const MIXED_SAS = [uniqueEmail(`${NS}_mc_sa`), uniqueEmail(`${NS}_mc_sa`)].sort();
    const MEMBER_NAME = { firstName: 'Automation', lastName: 'TestUser' };

    let pm;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            test.skip(!(await rbacEnabled(page)), 'RBAC is off (OSS build)');
            await createRole(page, counted.role(ROLE_MIXED));
            await createRole(page, counted.role(ROLE_NO_SA));
            await createMember(page, counted.user(MIXED_USER), 'user', MEMBER_NAME);
            await createMember(page, counted.user(NO_SA_USER), 'user', MEMBER_NAME);
            for (const email of MIXED_SAS) {
                await createServiceAccount(page, counted.serviceAccount(email));
            }
            await addRoleMembers(page, ROLE_MIXED, [MIXED_USER, ...MIXED_SAS]);
            await addRoleMembers(page, ROLE_NO_SA, [NO_SA_USER]);

            // The list counts from this map, so it must hold every membership before a page loads.
            await expect.poll(async () => {
                const map = await listMemberRoles(page);
                return [MIXED_USER, ...MIXED_SAS].every((e) => (map[e] || []).includes(ROLE_MIXED))
                    && (map[NO_SA_USER] || []).includes(ROLE_NO_SA);
            }, { timeout: 30000, message: 'role memberships never reached /users/roles/all' }).toBe(true);
            testLogger.info('member-count fixtures ready');
        } finally {
            await page.close();
        }
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            const gone = await counted.cleanup(page);
            testLogger.info(`teardown removed ${gone.roles.length} roles, ${gone.users.length} users, `
                + `${gone.serviceAccounts.length} service accounts`);
            const left = await counted.survivors(page);
            if (left.length) throw new Error(`teardown left its own artifacts behind: ${left}`);
        } finally {
            await page.close();
        }
    });

    test.beforeEach(async ({ page }) => {
        await navigateToBase(page);
        pm = new PageManager(page);
        test.skip(!(await rbacEnabled(page)), 'RBAC is off (OSS build)');
        await pm.rolesPage.gotoRoles();
    });

    test('MC-01 · each role shows its exact user and service account counts', {
        tag: ['@iam', '@iamRolesMemberCounts', '@P0', '@all']
    }, async () => {
        await pm.rolesPage.filterRoleList(ROLE_MIXED);
        const mixedSa = pm.rolesPage.roleMemberCount(ROLE_MIXED, 'service-accounts');
        await expect(mixedSa).toHaveText('2', { timeout: 30000 });
        // Service accounts share the member map with users, so Users must read 1 here, not 3.
        await expect(pm.rolesPage.roleMemberCount(ROLE_MIXED, 'users')).toHaveText('1');
        await expect(mixedSa).toHaveAttribute('aria-label', `${ROLE_MIXED}: 2 Service Accounts`);
        await expect(mixedSa).toHaveAttribute('data-o2-variant', 'ghost-primary');

        await pm.rolesPage.filterRoleList(ROLE_NO_SA);
        const noSa = pm.rolesPage.roleMemberCount(ROLE_NO_SA, 'service-accounts');
        await expect(noSa).toHaveText('0', { timeout: 30000 });
        await expect(noSa).toHaveAttribute('aria-label', `${ROLE_NO_SA}: 0 Service Accounts`);
        await expect(noSa).toHaveAttribute('data-o2-variant', 'ghost-muted');
        await expect(pm.rolesPage.roleMemberCount(ROLE_NO_SA, 'users')).toHaveText('1');
    });

    test('MC-02 · the service account count opens that role on Service Accounts, listing exactly its accounts', {
        tag: ['@iam', '@iamRolesMemberCounts', '@P0', '@all']
    }, async ({ page }) => {
        await pm.rolesPage.filterRoleList(ROLE_MIXED);
        const count = pm.rolesPage.roleMemberCount(ROLE_MIXED, 'service-accounts');
        await expect(count).toHaveText('2', { timeout: 30000 });
        await count.click();

        await expect(page).toHaveURL(new RegExp(`/iam/roles/edit/${ROLE_MIXED}\\?(.*&)?tab=serviceAccounts(&|$)`),
            { timeout: 15000 });
        await pm.rolesPage.expectTabActive('serviceAccounts');
        await expect(pm.rolesPage.tab('permissions')).toHaveAttribute('data-state', 'off');
        await expect(pm.rolesPage.tab('users')).toHaveAttribute('data-state', 'off');

        await expect(pm.rolesPage.serviceAccountMemberRows).toHaveCount(MIXED_SAS.length, { timeout: 30000 });
        await expect(pm.rolesPage.serviceAccountMemberRows.first()).toBeVisible();
        expect(await pm.rolesPage.serviceAccountMemberEmails()).toEqual(MIXED_SAS);
        for (const email of MIXED_SAS) {
            await expect(pm.rolesPage.serviceAccountMemberCheckbox(email)).toHaveAttribute('aria-checked', 'true');
        }
    });

    test('MC-03 · the user count opens that role on Users, listing exactly its users', {
        tag: ['@iam', '@iamRolesMemberCounts', '@P1', '@all']
    }, async ({ page }) => {
        await pm.rolesPage.filterRoleList(ROLE_MIXED);
        const count = pm.rolesPage.roleMemberCount(ROLE_MIXED, 'users');
        await expect(count).toHaveText('1', { timeout: 30000 });
        await count.click();

        await expect(page).toHaveURL(new RegExp(`/iam/roles/edit/${ROLE_MIXED}\\?(.*&)?tab=users(&|$)`),
            { timeout: 15000 });
        await pm.rolesPage.expectTabActive('users');
        await expect(pm.rolesPage.tab('serviceAccounts')).toHaveAttribute('data-state', 'off');

        await expect(pm.rolesPage.userMemberRows).toHaveCount(1, { timeout: 30000 });
        await expect(pm.rolesPage.userMemberRows.first()).toBeVisible();
        expect(await pm.rolesPage.userMemberEmails()).toEqual([MIXED_USER]);
        await expect(pm.rolesPage.userMemberCheckbox(MIXED_USER)).toHaveAttribute('aria-checked', 'true');
    });

    test('MC-04 · a zero service account count opens an empty Service Accounts tab', {
        tag: ['@iam', '@iamRolesMemberCounts', '@P1', '@all']
    }, async ({ page }) => {
        await pm.rolesPage.filterRoleList(ROLE_NO_SA);
        const count = pm.rolesPage.roleMemberCount(ROLE_NO_SA, 'service-accounts');
        await expect(count).toHaveText('0', { timeout: 30000 });
        await count.click();

        await expect(page).toHaveURL(new RegExp(`/iam/roles/edit/${ROLE_NO_SA}\\?(.*&)?tab=serviceAccounts(&|$)`),
            { timeout: 15000 });
        await pm.rolesPage.expectTabActive('serviceAccounts');

        // Selected is also empty before the list loads, so prove the load through All first.
        await pm.rolesPage.serviceAccountShowToggle('all').click();
        for (const email of MIXED_SAS) {
            await expect(pm.rolesPage.serviceAccountMemberCheckbox(email))
                .toHaveAttribute('aria-checked', 'false', { timeout: 30000 });
        }
        await pm.rolesPage.serviceAccountShowToggle('selected').click();
        await expect(pm.rolesPage.serviceAccountMemberRows).toHaveCount(0, { timeout: 15000 });
        await expect(pm.rolesPage.serviceAccountMembersEmpty).toBeVisible();
    });
});
