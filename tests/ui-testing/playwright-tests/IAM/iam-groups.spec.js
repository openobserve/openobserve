// IAM → User Groups (GR-01 .. GR-16)
//
// Plan: .claude/commands/nvpworkflow/iam-roles-redesign-tests.md
//
// The Groups UI is already on main — it is NOT part of the Edit Role redesign
// (openobserve#14682), which touches iam/roles/** only. Groups had zero E2E
// coverage because the old permission tree made the whole IAM area untestable.
//
// ENTERPRISE ONLY. Groups and Roles are gated on `rbac_enabled`
// (web/src/views/IdentityAccessManagement.vue:72). On an OSS build the whole
// Permissions section is absent, so the suite skips rather than fail or — worse —
// pass vacuously.
//
// Every artifact is namespaced `ui_auto_*` and removed in afterAll, including
// a sweep for leftovers from an earlier aborted run. Tests run sequentially in
// one worker (no describe.configure) because they share the fixture roles.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

const PREFIX = 'ui_auto';
const uniq = () => `${Date.now()}x${Math.floor(Math.random() * 10000)}`;

// Fixture roles, created once via API. Names are underscore-only on purpose:
// POST /roles normalizes anything outside [A-Za-z0-9_] to "_", and a later PUT
// does NOT normalize, so a hyphenated name would make teardown miss the row.
const ROLE_A = `${PREFIX}_role_a`;
const ROLE_B = `${PREFIX}_role_b`;
const ROLE_C = `${PREFIX}_role_c`;
const FIXTURE_ROLES = [ROLE_A, ROLE_B, ROLE_C];

// A non-root member and a service account, so the assignment tests exercise the
// real thing instead of skipping on an org that happens to have neither. A skip
// is not coverage — on a fresh CI org every one of those tests would be a no-op.
const MEMBER_EMAIL = `${PREFIX}_member@example.com`;
const SA_NAME = `${PREFIX}sa`;

// ---------- API layer ----------
// `page.request` shares the browser context's cookies and takes an explicit auth
// header, so it works on cloud (OIDC) and self-hosted (Basic) alike — and, unlike
// a page-side fetch, it needs no authenticated navigation first. That matters:
// beforeAll/afterAll run on a raw browser.newPage(), which carries none of the
// custom fixture's helpers, so navigateToBase() must NOT be called there.

const org = () => getOrgIdentifier();
const api = () => `${process.env.ZO_BASE_URL.replace(/\/$/, '')}/api`;

const req = async (page, method, path, data) => {
    const resp = await page.request.fetch(`${api()}/${org()}${path}`, {
        method,
        headers: getAuthHeaders(),
        ...(data ? { data } : {}),
    });
    return { status: resp.status(), body: await resp.json().catch(() => ({})) };
};

const listRoles = async (page) => (await req(page, 'GET', '/roles')).body || [];
const listGroups = async (page) => (await req(page, 'GET', '/groups')).body || [];
const getGroup = async (page, name) => (await req(page, 'GET', `/groups/${name}`)).body || {};
const listUsers = async (page) => (await req(page, 'GET', '/users')).body?.data ?? [];

const setGroup = (page, name, patch) =>
    req(page, 'PUT', `/groups/${name}`, {
        add_roles: [], remove_roles: [], add_users: [], remove_users: [], ...patch,
    });

const createRole = async (page, name) => {
    // 400 means it already exists — an aborted earlier run, or a retry.
    const { status } = await req(page, 'POST', '/roles', { role: name });
    if (status >= 400 && status !== 400) throw new Error(`create role ${name}: ${status}`);
};

const createGroupApi = async (page, name) => {
    const { status } = await req(page, 'POST', '/groups', { name, users: [], roles: [] });
    if (status >= 400 && status !== 400) throw new Error(`create group ${name}: ${status}`);
};

const createMember = async (page) => {
    const { status } = await req(page, 'POST', '/users', {
        email: MEMBER_EMAIL,
        password: 'Complexpass#123',
        first_name: 'IAM',
        last_name: 'Automation',
        role: 'admin',
    });
    // 400 = already there from an earlier run.
    if (status >= 400 && status !== 400) throw new Error(`create member: ${status}`);
    return MEMBER_EMAIL;
};

const createServiceAccount = async (page) => {
    // POST /service_accounts validates `email` as an email address — posting the bare
    // name returns 400 "Invalid email". The identifier the UI synthesizes from a name
    // is `<name>.<org>@sa.internal` (buildServiceAccountEmail), and that is also what
    // the API expects and what SA rows are keyed by.
    const email = `${SA_NAME}.${org()}@sa.internal`.toLowerCase();
    const { status, body } = await req(page, 'POST', '/service_accounts', {
        email,
        first_name: 'IAM automation',
    });
    if (status >= 400 && status !== 400) {
        throw new Error(`create service account: ${status} ${JSON.stringify(body).slice(0, 200)}`);
    }
    return email;
};

const deleteGroupApi = (page, name) => req(page, 'DELETE', `/groups/${name}`);
const deleteRoleApi = (page, name) => req(page, 'DELETE', `/roles/${name}`);

/** Every group/role this suite could have left behind, from this run or an older one. */
const sweepLeftovers = async (page) => {
    const removed = { groups: [], roles: [] };
    for (const g of await listGroups(page)) {
        if (typeof g === 'string' && g.startsWith(PREFIX)) {
            await deleteGroupApi(page, g);
            removed.groups.push(g);
        }
    }
    // Roles go second: a role cannot be cleanly dropped while a group still holds it.
    for (const r of await listRoles(page)) {
        if (typeof r === 'string' && r.startsWith(PREFIX)) {
            await deleteRoleApi(page, r);
            removed.roles.push(r);
        }
    }
    // Members and service accounts last — they are the leaf artifacts.
    removed.users = [];
    for (const u of await listUsers(page)) {
        if (typeof u?.email === 'string' && u.email.startsWith(PREFIX)) {
            await req(page, 'DELETE', `/users/${u.email}`);
            removed.users.push(u.email);
        }
    }
    for (const sa of (await req(page, 'GET', '/service_accounts')).body?.data ?? []) {
        if (typeof sa?.email === 'string' && sa.email.startsWith(PREFIX) && !sa.is_system) {
            await req(page, 'DELETE', `/service_accounts/${sa.email}`);
            removed.users.push(sa.email);
        }
    }
    return removed;
};

// ---------- suite ----------

test.describe('IAM · User Groups', () => {
    let pm;

    test.beforeEach(async ({ page }) => {
        await navigateToBase(page);
        pm = new PageManager(page);
        // Capability is decided by the API, not by how fast a tab paints: a UI-timeout
        // probe silently turns a slow render into a skip, and the run still reports green.
        const { status } = await req(page, 'GET', '/groups');
        test.skip(status >= 400, 'RBAC is off (OSS build)');
        await page.locator('[data-test="menu-link-\\/iam-item"]').click();
        await pm.groupsPage.groupsTab.waitFor({ state: 'visible', timeout: 30000 });
    });

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await sweepLeftovers(page);
            for (const r of FIXTURE_ROLES) await createRole(page, r);
            await createMember(page);
            await createServiceAccount(page);
            testLogger.info(
                `fixtures ready: roles=${FIXTURE_ROLES.join(',')} member=${MEMBER_EMAIL} sa=${SA_NAME}`,
            );
        } finally {
            await page.close();
        }
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            const removed = await sweepLeftovers(page);
            testLogger.info(
                `teardown removed ${removed.groups.length} groups, ${removed.roles.length} roles, ` +
                `${removed.users.length} users/service accounts`,
            );
            // Teardown must actually be clean, or the next run inherits state.
            const leftoverGroups = (await listGroups(page)).filter(
                (g) => typeof g === 'string' && g.startsWith(PREFIX),
            );
            const leftoverRoles = (await listRoles(page)).filter(
                (r) => typeof r === 'string' && r.startsWith(PREFIX),
            );
            if (leftoverGroups.length || leftoverRoles.length) {
                throw new Error(
                    `teardown left artifacts behind — groups: ${leftoverGroups}, roles: ${leftoverRoles}`,
                );
            }
        } finally {
            await page.close();
        }
    });

    // ---------------- GR-01 ----------------
    test('GR-01 · creating a group opens its editor, and it is listed and stored', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_g01_${uniq()}`;

        await pm.groupsPage.gotoGroups();
        // Creating pushes straight into the editor (AppGroups.vue onGroupAdded),
        // which createGroup() asserts — a new group is never shown in the list first.
        await pm.groupsPage.createGroup(name);

        // API truth, then the list reflection: separates "the create failed" from
        // "the list did not refresh".
        await expect.poll(async () => await listGroups(page), { timeout: 15000 }).toContain(name);
        await pm.groupsPage.backToList();
        await pm.groupsPage.expectGroupListed(name);
    });

    // ---------------- GR-02 ----------------
    test('GR-02 · the editor opens on Roles with the Selected filter active', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_g02_${uniq()}`;
        await createGroupApi(page, name);

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.openGroup(name);

        await expect(pm.groupsPage.rolesTable).toBeVisible();
        // `Selected` is the default view; it is what makes GR-04 reachable at all.
        await expect(pm.groupsPage.showSelectedButton('roles')).toHaveAttribute('aria-pressed', 'true');
        await expect(pm.groupsPage.showAllButton('roles')).toHaveAttribute('aria-pressed', 'false');
    });

    // ---------------- GR-03 ----------------
    test('GR-03 · All lists every org role, Selected lists only the group\'s', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_g03_${uniq()}`;
        await createGroupApi(page, name);
        await setGroup(page, name, { add_roles: [ROLE_A], add_users: [] });

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.openGroup(name);

        await expect(pm.groupsPage.rowsIn('roles')).toHaveCount(1);
        await expect(pm.groupsPage.rowCheckbox('roles', ROLE_A)).toBeVisible();

        await pm.groupsPage.showAllButton('roles').click();
        const orgRoles = await listRoles(page);
        await expect(pm.groupsPage.rowsIn('roles')).toHaveCount(orgRoles.length);
    });

    // ---------------- GR-04 (B1 regression) ----------------
    test.fixme(
        'GR-04 · an empty group must not claim the org has no roles [o2-enterprise#2696]',
        async ({ page }, testInfo) => {
            testLogger.testStart(testInfo.title, testInfo.file);
            const name = `${PREFIX}_g04_${uniq()}`;
            await createGroupApi(page, name);

            // Precondition: the org really does have roles, so "No roles yet" is a lie.
            expect((await listRoles(page)).length).toBeGreaterThan(0);

            await pm.groupsPage.gotoGroups();
            await pm.groupsPage.openGroup(name);

            // Default view is Selected with nothing selected. GroupRoles.vue drives
            // OEmptyState's `filtered` off the SEARCH BOX only, so it falls through
            // to the org-level `no-roles` preset and tells the user to create a role
            // they already have.
            const empty = pm.groupsPage.rolesTable.locator('..').getByText(/no roles/i);
            await expect(empty).not.toContainText('Create a custom role');
            await expect(empty).toContainText(/selected|switch to all/i);
        },
    );

    // ---------------- GR-05 (B1, layout half) ----------------
    test.fixme(
        'GR-05 · the empty-state description is not clipped by the pagination bar [o2-enterprise#2696]',
        async ({ page }, testInfo) => {
            testLogger.testStart(testInfo.title, testInfo.file);
            const name = `${PREFIX}_g05_${uniq()}`;
            await createGroupApi(page, name);

            await pm.groupsPage.gotoGroups();
            await pm.groupsPage.openGroup(name);

            // The hero empty state renders inside a pane whose footer overlaps it;
            // on pentest the copy ended mid-sentence at "...Create a custom role to control".
            const desc = page.locator('[data-test="o-empty-state-description"]').first();
            await expect(desc).toBeVisible();
            const clipped = await desc.evaluate(
                (el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
            );
            expect(clipped, 'empty-state description is visually truncated').toBe(false);
        },
    );

    // ---------------- GR-06 ----------------
    test('GR-06 · assigning roles in the UI is what the API stores', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_g06_${uniq()}`;
        await createGroupApi(page, name);

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.openGroup(name);
        await pm.groupsPage.assign('roles', ROLE_A);
        await pm.groupsPage.assign('roles', ROLE_B);
        await pm.groupsPage.save();

        await expect
            .poll(async () => (await getGroup(page, name)).roles?.sort() ?? [], { timeout: 15000 })
            .toEqual([ROLE_A, ROLE_B].sort());
    });

    // ---------------- GR-07 ----------------
    test('GR-07 · assigning a user in the UI is what the API stores', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_g07_${uniq()}`;
        await createGroupApi(page, name);

        const target = { email: MEMBER_EMAIL };

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.openGroup(name);
        await pm.groupsPage.switchTab('users');
        await pm.groupsPage.assign('users', target.email);
        await pm.groupsPage.save();

        await expect
            .poll(async () => (await getGroup(page, name)).users ?? [], { timeout: 15000 })
            .toContain(target.email);
    });

    // ---------------- GR-08 ----------------
    test('GR-08 · the Service Accounts tab assigns a service account', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_g08_${uniq()}`;
        await createGroupApi(page, name);

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.openGroup(name);

        const hasTab = await pm.groupsPage.tabServiceAccounts.isVisible().catch(() => false);
        test.skip(!hasTab, 'service accounts disabled in this org (service_account_enabled)');

        await pm.groupsPage.switchTab('serviceAccounts');
        const sa = `${SA_NAME}.${org()}@sa.internal`.toLowerCase();
        await pm.groupsPage.assign('service-accounts', sa);
        await pm.groupsPage.save();

        // Service accounts are stored in the group's `users` list, same as people.
        await expect
            .poll(async () => (await getGroup(page, name)).users ?? [], { timeout: 15000 })
            .toContain(sa);
    });

    // ---------------- GR-09 ----------------
    test('GR-09 · removing a role in the UI removes it in the API', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_g09_${uniq()}`;
        await createGroupApi(page, name);
        await setGroup(page, name, { add_roles: [ROLE_A, ROLE_B], add_users: [] });

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.openGroup(name);
        await pm.groupsPage.unassign('roles', ROLE_A);
        await pm.groupsPage.save();

        await expect
            .poll(async () => (await getGroup(page, name)).roles ?? [], { timeout: 15000 })
            .toEqual([ROLE_B]);
    });

    // ---------------- GR-10 ----------------
    test('GR-10 · search narrows the roles and users selection tables', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_g10_${uniq()}`;
        await createGroupApi(page, name);

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.openGroup(name);
        await pm.groupsPage.showAllButton('roles').click();

        await pm.groupsPage.selectionSearch('roles').fill(ROLE_A);
        await expect(pm.groupsPage.rowCheckbox('roles', ROLE_A)).toBeVisible();
        await expect(pm.groupsPage.rowCheckbox('roles', ROLE_B)).toHaveCount(0);

        await pm.groupsPage.selectionSearch('roles').fill('');
        await expect(pm.groupsPage.rowCheckbox('roles', ROLE_B)).toBeVisible();
    });

    // ---------------- GR-11 ----------------
    test('GR-11 · search and the Selected filter compose', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_g11_${uniq()}`;
        await createGroupApi(page, name);
        await setGroup(page, name, { add_roles: [ROLE_A], add_users: [] });

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.openGroup(name);

        // Selected + a term matching a role the group does NOT hold => no rows,
        // and this must read as a filtered empty state, not "no roles exist".
        await pm.groupsPage.selectionSearch('roles').fill(ROLE_B);
        await expect(pm.groupsPage.rowCheckbox('roles', ROLE_B)).toHaveCount(0);

        await pm.groupsPage.selectionSearch('roles').fill(ROLE_A);
        await expect(pm.groupsPage.rowCheckbox('roles', ROLE_A)).toBeVisible();
    });

    // ---------------- GR-12 ----------------
    test('GR-12 · a group holding many roles renders them all', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_g12_${uniq()}`;
        await createGroupApi(page, name);
        await setGroup(page, name, { add_roles: FIXTURE_ROLES });

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.openGroup(name);

        await expect(pm.groupsPage.rowsIn('roles')).toHaveCount(FIXTURE_ROLES.length);
        for (const r of FIXTURE_ROLES) {
            await expect(pm.groupsPage.rowCheckbox('roles', r)).toBeVisible();
        }
    });

    // ---------------- GR-13 ----------------
    test('GR-13 · a role deleted while a group still holds it does not break the editor', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_g13_${uniq()}`;
        const doomed = `${PREFIX}_role_doomed_${uniq()}`;
        await createRole(page, doomed);
        await createGroupApi(page, name);
        await setGroup(page, name, { add_roles: [doomed], add_users: [] });

        // Delete the role out from under the group — a dangling reference.
        await deleteRoleApi(page, doomed);

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.openGroup(name);

        // The editor must render rather than throw on the missing role.
        await expect(pm.groupsPage.rolesTable).toBeVisible({ timeout: 15000 });
        await expect(pm.groupsPage.saveButton).toBeEnabled();
    });

    // ---------------- GR-14 ----------------
    test('GR-14 · a group deleted in the UI is gone from the list and the API', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_g14_${uniq()}`;
        await createGroupApi(page, name);

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.expectGroupListed(name);
        await pm.groupsPage.deleteGroup(name);

        await expect
            .poll(async () => await listGroups(page), { timeout: 15000 })
            .not.toContain(name);
    });

    // ---------------- GR-15 ----------------
    test('GR-15 · a group with users but no roles saves cleanly', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_g15_${uniq()}`;
        await createGroupApi(page, name);

        const target = { email: MEMBER_EMAIL };

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.openGroup(name);
        await pm.groupsPage.switchTab('users');
        await pm.groupsPage.assign('users', target.email);
        await pm.groupsPage.save();

        await expect
            .poll(async () => (await getGroup(page, name)).users ?? [], { timeout: 15000 })
            .toContain(target.email);
        expect((await getGroup(page, name)).roles ?? []).toEqual([]);
    });


    // ================= negative / rejection cases (GR-N*) =================
    // The suite above proves the happy paths store what the UI shows. These prove
    // the UI refuses what the API would refuse — the half that silently rots,
    // because a broken guard still looks like a working screen.

    test('GR-N1 · a blank group name is refused', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const before = await listGroups(page);

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.addGroupButton.click();
        await expect(pm.groupsPage.addGroupDialog).toBeVisible();
        await pm.groupsPage.groupNameInput.fill('');
        await pm.groupsPage.addGroupSaveButton.click();

        // The dialog must stay open — a close here means a nameless group was stored.
        await expect(pm.groupsPage.addGroupDialog).toBeVisible();
        expect(await listGroups(page)).toEqual(before);
    });

    test('GR-N2 · a whitespace-only group name is refused', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const before = await listGroups(page);

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.addGroupButton.click();
        await expect(pm.groupsPage.addGroupDialog).toBeVisible();
        // saveGroup() trims before sending, so "   " must be caught as empty and
        // never reach the API as a name of spaces.
        await pm.groupsPage.groupNameInput.fill('   ');
        await pm.groupsPage.addGroupSaveButton.click();

        await expect(pm.groupsPage.addGroupDialog).toBeVisible();
        expect(await listGroups(page)).toEqual(before);
    });

    test('GR-N3 · a duplicate group name is refused and does not clobber the original', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_gn3_${uniq()}`;
        await createGroupApi(page, name);
        await setGroup(page, name, { add_roles: [ROLE_A] });

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.addGroupButton.click();
        await expect(pm.groupsPage.addGroupDialog).toBeVisible();
        await pm.groupsPage.groupNameInput.fill(name);
        await pm.groupsPage.addGroupSaveButton.click();

        // Whether it surfaces inline or as a toast, the original must survive intact —
        // a duplicate create that overwrites would silently drop ROLE_A.
        await expect
            .poll(async () => (await getGroup(page, name)).roles ?? [], { timeout: 15000 })
            .toEqual([ROLE_A]);
        expect((await listGroups(page)).filter((g) => g === name)).toHaveLength(1);
    });

    test('GR-N4 · the name field is capped at its maxlength', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        // AddGroup.vue sets :maxlength="100"; a longer paste must be truncated by the
        // control rather than sent and rejected (or worse, stored) server-side.
        const overlong = `${PREFIX}_${'z'.repeat(200)}`;

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.addGroupButton.click();
        await expect(pm.groupsPage.addGroupDialog).toBeVisible();
        await pm.groupsPage.groupNameInput.fill(overlong);

        const typed = await pm.groupsPage.groupNameInput.inputValue();
        expect(typed.length).toBeLessThanOrEqual(100);

        await pm.groupsPage.addGroupCancelButton.click();
        expect((await listGroups(page)).some((g) => g.startsWith(`${PREFIX}_zzz`))).toBe(false);
    });

    test('GR-N5 · Cancel discards staged role changes', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_gn5_${uniq()}`;
        await createGroupApi(page, name);
        await setGroup(page, name, { add_roles: [ROLE_A] });

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.openGroup(name);
        await pm.groupsPage.assign('roles', ROLE_B);   // stage an addition
        await pm.groupsPage.unassign('roles', ROLE_A); // and a removal

        // EditGroup has a route-leave guard: cancelling with staged changes must be
        // challenged, not silently obeyed. That the guard fires is itself the proof
        // both edits were staged.
        expect(await pm.groupsPage.cancelRaisesLeaveGuard()).toBe(true);
        await page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]').click();
        await expect(pm.groupsPage.tableSection).toBeVisible({ timeout: 15000 });

        // Nothing staged may reach the API.
        const stored = await getGroup(page, name);
        expect((stored.roles ?? []).sort()).toEqual([ROLE_A]);
    });

    test('GR-N6 · a search matching nothing empties the table without losing the selection', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_gn6_${uniq()}`;
        await createGroupApi(page, name);
        await setGroup(page, name, { add_roles: [ROLE_A] });

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.openGroup(name);
        await pm.groupsPage.selectionSearch('roles').fill('zzz_no_such_role_zzz');
        await expect(pm.groupsPage.rowsIn('roles')).toHaveCount(0);

        // Clearing the filter must bring the row back still ticked — a filter that
        // drops staged/held state is how assignments get silently lost.
        await pm.groupsPage.selectionSearch('roles').fill('');
        await expect(pm.groupsPage.rowCheckbox('roles', ROLE_A)).toBeVisible();
        expect(await pm.groupsPage.isRowChecked('roles', ROLE_A)).toBe(true);
    });

    test('GR-N7 · deleting a group is refused until confirmed', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_gn7_${uniq()}`;
        await createGroupApi(page, name);

        await pm.groupsPage.gotoGroups();
        await pm.groupsPage.searchGroups(name);
        await pm.groupsPage.page
            .locator(`[data-test="iam-groups-delete-${name}-role-icon"]`)
            .click();

        // Dismiss the confirm — the group must survive.
        await page.locator('[data-test="o-dialog-secondary-btn"]').first().click();
        expect(await listGroups(page)).toContain(name);
    });

    // ---------------- GR-16 ----------------
    test('GR-16 · the Roles list Users column counts DIRECT holders only', async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `${PREFIX}_g16_${uniq()}`;
        await createGroupApi(page, name);

        const target = { email: MEMBER_EMAIL };

        // ROLE_C reaches the user only through the group — never directly.
        await setGroup(page, name, { add_roles: [ROLE_C], add_users: [target.email] });

        // API truth: group membership does not make a direct role holder.
        const direct = (await req(page, 'GET', `/roles/${ROLE_C}/users`)).body ?? [];
        expect(direct).not.toContain(target.email);

        // The UI column renders that same number, so it must agree — a role people
        // actually hold through a group shows 0. Pinned so the two cannot drift.
        await pm.groupsPage.rolesTab.click();
        const row = page.locator('tr', { has: page.locator(`text="${ROLE_C}"`) }).first();
        await expect(row).toBeVisible({ timeout: 15000 });
        // Columns: checkbox, #, Role Name, Users, Actions. Assert the Users cell
        // itself — a bare toContainText('0') would also match the "01" index cell.
        await expect(row.locator('td').nth(3)).toHaveText(String(direct.length));
    });
});
