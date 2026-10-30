// IAM → who can actually do this (A-01 .. A-10)
//
// Plan: .claude/commands/nvpworkflow/iam-roles-redesign-tests.md
//
// Every other IAM spec runs as root, and root bypasses every permission check —
// so none of them prove a role RESTRICTS anything. These do. Each test signs in
// as a purpose-made non-root user in its own browser context.
//
// The base role is `user`: it carries no built-in permissions, so whatever the
// custom role grants is the whole of that account's access. Creating these as
// `admin` would make every assertion pass for the wrong reason.
//
// ENTERPRISE ONLY (rbac_enabled). Artifacts live under this file's OWN namespace
// (see NS below) — never the shared `ui_auto`, which the parallel specs would share.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const {
    ns, req, listRoles, listUsers, createRole, setRolePerms, createGroupApi, setGroup,
    makeTracker, loginAs, MEMBER_PASSWORD, uniq, org,
} = require('./iam-fixtures.js');

// This file's own namespace. Every artifact it creates lives under it, and its
// sweeps delete only it: the eleven IAM specs run in parallel and, through a
// shared `ui_auto` prefix, used to delete each other's fixtures mid-test.
const NS = ns('acc');

// What this spec made, so teardown deletes exactly that — never a prefix sweep,
// which is what had the IAM specs deleting each other's fixtures mid-test.
const made = makeTracker();

const obj = (resource) => `${resource}:_all_${org()}`;

// One account per access shape, so a test never inherits another's grants.
const U_READER = `${NS}_a_reader@example.com`;   // role:AllowList+AllowGet
const U_ADMIN = `${NS}_a_admin@example.com`;     // role+group AllowAll
const U_NONE = `${NS}_a_none@example.com`;       // no IAM grants at all
const U_GROUPS = `${NS}_a_groups@example.com`;   // group:AllowAll, no role grant
const U_VIAGRP = `${NS}_a_viagrp@example.com`;   // reaches its grant via a group

const R_READER = `${NS}_a_role_reader`;
const R_ADMIN = `${NS}_a_role_admin`;
const R_GROUPS = `${NS}_a_role_groups`;
const R_VIAGRP = `${NS}_a_role_viagrp`;
const G_CARRIER = `${NS}_a_group_carrier`;

let sessions = [];
const signIn = async (browser, email) => {
    const s = await loginAs(browser, email, MEMBER_PASSWORD);
    sessions.push(s);
    return s.page;
};

const gotoIam = async (page) => {
    await page.goto(`${process.env.ZO_BASE_URL}/web/iam/roles?org_identifier=${org()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
};

test.describe('IAM · access control', { tag: '@enterprise' }, () => {
    // Serial, NOT parallel. the five accounts, four roles and the carrier group are made once in beforeAll and reused; A-08/A-09 deliberately mutate G_CARRIER and restore it.
    // `fullyParallel: true` races individual TESTS, so the per-file namespaces in
    // iam-fixtures.js only stop files colliding — this stops a file colliding with
    // itself. Cost: a failure here skips the rest of the file rather than running them.
    test.describe.configure({ mode: 'serial' });

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {

            const probe = await req(page, 'GET', '/roles');
            test.skip(probe.status === 403 || probe.status === 404, 'roles API unavailable — RBAC off');

            for (const [email, role] of [
                [U_READER, R_READER], [U_ADMIN, R_ADMIN],
                [U_NONE, null], [U_GROUPS, R_GROUPS], [U_VIAGRP, null],
            ]) {
                // Base role `user` grants nothing on its own.
                made.user(email);
                await req(page, 'POST', '/users', {
                    email, password: MEMBER_PASSWORD,
                    first_name: 'IAM', last_name: 'Access', role: 'user',
                });
                // Braces matter: U_NONE and U_VIAGRP pass role=null on purpose, and an
                // unguarded createRole(page, null) is a 422.
                if (role) {
                    made.role(role);
                    await createRole(page, role);
                }
            }

            await setRolePerms(page, R_READER,
                [{ object: obj('role'), permission: 'AllowList' },
                 { object: obj('role'), permission: 'AllowGet' }]);
            await req(page, 'PUT', `/roles/${R_READER}`, {
                add: [], remove: [], add_users: [U_READER], remove_users: [],
            });

            await setRolePerms(page, R_ADMIN,
                [{ object: obj('role'), permission: 'AllowAll' },
                 { object: obj('group'), permission: 'AllowAll' }]);
            await req(page, 'PUT', `/roles/${R_ADMIN}`, {
                add: [], remove: [], add_users: [U_ADMIN], remove_users: [],
            });

            await setRolePerms(page, R_GROUPS, [{ object: obj('group'), permission: 'AllowAll' }]);
            await req(page, 'PUT', `/roles/${R_GROUPS}`, {
                add: [], remove: [], add_users: [U_GROUPS], remove_users: [],
            });

            // U_VIAGRP holds R_VIAGRP ONLY through G_CARRIER — never directly.
            made.role(R_VIAGRP);
            await createRole(page, R_VIAGRP);
            await setRolePerms(page, R_VIAGRP,
                [{ object: obj('role'), permission: 'AllowList' },
                 { object: obj('role'), permission: 'AllowGet' }]);
            made.group(G_CARRIER);
            await createGroupApi(page, G_CARRIER);
            await setGroup(page, G_CARRIER, { add_roles: [R_VIAGRP], add_users: [U_VIAGRP] });

            testLogger.info('access fixtures ready');
        } finally {
            await page.close();
        }
    });

    test.afterEach(async () => {
        for (const s of sessions) await s.context.close().catch(() => {});
        sessions = [];
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

    test('A-01 · a read-only IAM user sees the Roles tab', {
        tag: ['@iam', '@iamRolesAccess', '@P1', '@all']
    }, async ({ browser }) => {
        const page = await signIn(browser, U_READER);
        await gotoIam(page);
        await expect(page.locator('[data-test="iam-roles-tab"]')).toBeVisible({ timeout: 20000 });
    });

    test('A-02 · a read-only IAM user cannot create a role', {
        tag: ['@iam', '@iamRolesAccess', '@P0', '@all']
    }, async ({ browser }) => {
        const page = await signIn(browser, U_READER);
        await gotoIam(page);

        // Either the affordance is absent, or the API refuses. Both are acceptable;
        // silently succeeding is not.
        const btn = page.locator('[data-test="iam-roles-add-role-btn"]');
        if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
            const res = await req(page, 'POST', '/roles', { role: `${NS}_a_denied_${uniq()}` });
            expect(res.status, 'a List/Get-only user was allowed to create a role').toBeGreaterThanOrEqual(400);
        }
    });

    test('A-03 · an IAM admin can create and delete a role', {
        tag: ['@iam', '@iamRolesAccess', '@P0', '@all']
    }, async ({ browser }) => {
        const page = await signIn(browser, U_ADMIN);
        await gotoIam(page);
        const name = `${NS}_a_made_${uniq()}`;

        const created = await req(page, 'POST', '/roles', { role: name });
        expect(created.status).toBeLessThan(400);
        await expect.poll(async () => await listRoles(page), { timeout: 15000 }).toContain(name);

        const deleted = await req(page, 'DELETE', `/roles/${name}`);
        expect(deleted.status).toBeLessThan(400);
    });

    // SKIPPED — the test's premise is wrong, not the product. Reproduced on pentest
    // (matched build): a user with no IAM grants still gets `iam-roles-tab`.
    // IdentityAccessManagement.vue renders both Roles and Groups on
    // `visible: isEnt && rbac` — build type and rbac_enabled only. Tab visibility was
    // never permission-gated, so there is nothing here to "revoke".
    //
    // Not a security issue: A-05 covers the half that matters and passes, i.e. the
    // API refuses this user outright. What is left is a UX wart — an affordance is
    // offered that the backend then denies. Worth raising separately if we want the
    // tabs permission-gated; until that is decided this test asserts a behaviour the
    // product does not have.
    test.fixme('A-04 · a user with no IAM grants gets no Roles tab', {
        tag: ['@iam', '@iamRolesAccess', '@P0', '@all']
    }, async ({ browser }) => {
        const page = await signIn(browser, U_NONE);
        await gotoIam(page);
        // Nothing granted means nothing offered — the tab must not merely error on click.
        await expect(page.locator('[data-test="iam-roles-tab"]')).toHaveCount(0);
    });

    test('A-05 · a user with no IAM grants cannot read roles through the API either', {
        tag: ['@iam', '@iamRolesAccess', '@P0', '@all']
    }, async ({ browser }) => {
        const page = await signIn(browser, U_NONE);
        await gotoIam(page);
        const res = await req(page, 'GET', '/roles');
        // A hidden tab with an open API is not access control.
        expect(res.status, 'an ungranted user could list roles').toBeGreaterThanOrEqual(400);
    });

    test('A-06 · group permissions do not leak into role permissions', {
        tag: ['@iam', '@iamRolesAccess', '@P0', '@all']
    }, async ({ browser }) => {
        const page = await signIn(browser, U_GROUPS);
        await gotoIam(page);

        // group:AllowAll must not imply anything about `role`.
        const groups = await req(page, 'GET', '/groups');
        expect(groups.status).toBeLessThan(400);
        const roles = await req(page, 'POST', '/roles', { role: `${NS}_a_leak_${uniq()}` });
        expect(roles.status, 'group:AllowAll leaked into role creation').toBeGreaterThanOrEqual(400);
    });

    test('A-07 · a permission reaching a user through a group is honoured', {
        tag: ['@iam', '@iamRolesAccess', '@P0', '@all']
    }, async ({ browser }) => {
        const page = await signIn(browser, U_VIAGRP);
        await gotoIam(page);

        // U_VIAGRP holds role:AllowList+AllowGet ONLY via G_CARRIER. This is the
        // composition the whole Groups feature exists for, and nothing else tests it.
        const res = await req(page, 'GET', '/roles');
        expect(res.status, 'a grant inherited through a group was not honoured').toBeLessThan(400);
        await expect(page.locator('[data-test="iam-roles-tab"]')).toBeVisible({ timeout: 20000 });
    });

    test('A-08 · removing the user from the group revokes that access', {
        tag: ['@iam', '@iamRolesAccess', '@P0', '@all']
    }, async ({ browser }) => {
        const root = await browser.newPage();
        try {
            await setGroup(root, G_CARRIER, { remove_users: [U_VIAGRP] });

            const page = await signIn(browser, U_VIAGRP);
            await gotoIam(page);
            const res = await req(page, 'GET', '/roles');
            expect(res.status, 'access survived removal from the carrying group').toBeGreaterThanOrEqual(400);
        } finally {
            // Restore, so ordering between tests cannot matter.
            await setGroup(root, G_CARRIER, { add_users: [U_VIAGRP] }).catch(() => {});
            await root.close();
        }
    });

    test('A-09 · removing the role from the group revokes that access', {
        tag: ['@iam', '@iamRolesAccess', '@P0', '@all']
    }, async ({ browser }) => {
        const root = await browser.newPage();
        try {
            await setGroup(root, G_CARRIER, { remove_roles: [R_VIAGRP] });

            const page = await signIn(browser, U_VIAGRP);
            await gotoIam(page);
            const res = await req(page, 'GET', '/roles');
            expect(res.status, 'access survived the role leaving the group').toBeGreaterThanOrEqual(400);
        } finally {
            await setGroup(root, G_CARRIER, { add_roles: [R_VIAGRP] }).catch(() => {});
            await root.close();
        }
    });

    test('A-10 · deleting a role revokes the access it carried', {
        tag: ['@iam', '@iamRolesAccess', '@P0', '@all']
    }, async ({ browser }) => {
        const root = await browser.newPage();
        const doomed = `${NS}_a_role_doomed`;
        const victim = `${NS}_a_victim@example.com`;
        try {
            made.role(doomed);
            await createRole(root, doomed);
            await setRolePerms(root, doomed, [{ object: obj('role'), permission: 'AllowList' }]);
            made.user(victim);
            await req(root, 'POST', '/users', {
                email: victim, password: MEMBER_PASSWORD,
                first_name: 'IAM', last_name: 'Victim', role: 'user',
            });
            await req(root, 'PUT', `/roles/${doomed}`, {
                add: [], remove: [], add_users: [victim], remove_users: [],
            });

            const before = await signIn(browser, victim);
            await gotoIam(before);
            expect((await req(before, 'GET', '/roles')).status).toBeLessThan(400);
            await sessions.pop().context.close();

            await req(root, 'DELETE', `/roles/${doomed}`);

            const after = await signIn(browser, victim);
            await gotoIam(after);
            expect(
                (await req(after, 'GET', '/roles')).status,
                'access outlived the role that granted it',
            ).toBeGreaterThanOrEqual(400);
        } finally {
            await req(root, 'DELETE', `/users/${victim}`).catch(() => {});
            await root.close();
        }
    });
});
