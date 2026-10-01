// IAM → Edit Role · enforcement, end to end (E-01 .. E-06)
//
// Plan: .claude/commands/nvpworkflow/iam-roles-redesign-tests.md (Wave 2, flows 1-6)
//
// The grants specs prove the editor WRITES the right tuple. These close the loop: a
// grant made BY TICKING A BOX IN THE EDITOR has to change what a real non-root user
// can actually do, and removing it has to put that user back exactly where they
// started.
//
// The grant is deliberately made through the UI rather than seeded over the API. A
// seeded grant tests the backend, which the ENT pytest suite already covers
// (rbac/users/test_custom_roles.py); only the editor path tests the thing this
// redesign changed. That is also why this spec belongs in the browser harness at all.
//
// Two rules make the difference between a real test and a green one:
//
//  1. Every access assertion goes through reqAs(), never req(). req() attaches root
//     Basic auth, and root bypasses authorization — the assertion would pass whatever
//     the role said. See the comment on reqAs in iam-fixtures.js.
//  2. Access is compared against a BASELINE captured from an account that holds
//     nothing, not against a hardcoded status. "Denied" is 403 on one endpoint and 404
//     or 400 on another; the baseline is the only thing that stays true if that
//     changes.
//
// ENTERPRISE ONLY (rbac_enabled), and needs a build carrying openobserve#14682.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const {
    PREFIX, req, reqAs, allowed, listRoles, listUsers, createRole, setRolePerms,
    sweepRoles, sweepUsers, loginAs, MEMBER_PASSWORD, org, rbacEnabled,
    createDashboardFolder, createDashboardIn, sweepDashboardFolders,
} = require('./iam-fixtures.js');

const obj = (resource) => `${resource}:_all_${org()}`;

// Two logs streams, so "can read the stream I was granted" is distinguishable from
// "can read any stream". One stream cannot tell those apart.
const S_GRANTED = `${PREFIX}_e_s_granted`;
const S_OTHER = `${PREFIX}_e_s_other`;

const U_STREAM = `${PREFIX}_e_stream@example.com`;
const U_TYPE = `${PREFIX}_e_type@example.com`;
const U_PAIR = `${PREFIX}_e_pair@example.com`;
const U_BASE = `${PREFIX}_e_base@example.com`;    // nothing, ever — the baseline
const U_FOLDER = `${PREFIX}_e_folder@example.com`;
const U_ITEM = `${PREFIX}_e_item@example.com`;

const R_STREAM = `${PREFIX}_e_role_stream`;
const R_TYPE = `${PREFIX}_e_role_type`;
const R_PAIR = `${PREFIX}_e_role_pair`;
const R_FOLDER = `${PREFIX}_e_role_folder`;
const R_ITEM = `${PREFIX}_e_role_item`;

// One folder with two dashboards, plus a dashboard in a second folder. The neighbour
// proves a grant does not widen inside a folder; the other folder proves it does not
// widen across folders.
const F_MAIN = `${PREFIX}_e_folder_main`;
const F_AWAY = `${PREFIX}_e_folder_away`;
let fMain, fAway, dGranted, dNeighbour, dAway;

let sessions = [];

test.describe('IAM · Edit Role · enforcement', { tag: '@enterprise' }, () => {
    let pm;

    const signIn = async (browser, email) => {
        const s = await loginAs(browser, email, MEMBER_PASSWORD);
        sessions.push(s);
        return s.page;
    };

    // The three reads E-01 distinguishes, run byte-identically for baseline and user.
    const readGranted = (p) => reqAs(p, 'GET', `/streams/${S_GRANTED}/schema?type=logs`);
    const readOther = (p) => reqAs(p, 'GET', `/streams/${S_OTHER}/schema?type=logs`);
    const readList = (p) => reqAs(p, 'GET', '/streams?type=logs');

    const accessOf = async (p) => ({
        granted: allowed(await readGranted(p)),
        other: allowed(await readOther(p)),
        list: allowed(await readList(p)),
    });

    /** What an account holding nothing can do. Everything else is compared to this. */
    const baseline = async (browser) => accessOf(await signIn(browser, U_BASE));

    /** Opens a role in the editor, ready to tick. */
    const openRole = async (name, held = 0) => {
        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.openRole(name);
        await pm.rolesPage.waitForGrantsSettled(held);
    };

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await sweepRoles(page);
            await sweepUsers(page);
            await sweepDashboardFolders(page);

            const probe = await req(page, 'GET', '/roles');
            test.skip(probe.status === 403 || probe.status === 404, 'roles API unavailable — RBAC off');

            // Ingest so both streams exist with a schema; a grant on a stream the
            // backend has never seen is not the thing under test.
            for (const stream of [S_GRANTED, S_OTHER]) {
                await req(page, 'POST', `/${stream}/_json`, [
                    { _timestamp: Date.now() * 1000, level: 'info', msg: `seed ${stream}` },
                ]);
            }
            for (const stream of [S_GRANTED, S_OTHER]) {
                await expect
                    .poll(async () => (await req(page, 'GET', `/streams/${stream}/schema?type=logs`)).status,
                        { timeout: 30000, intervals: [500, 1000, 2000] })
                    .toBeLessThan(400);
            }

            fMain = await createDashboardFolder(page, F_MAIN);
            fAway = await createDashboardFolder(page, F_AWAY);
            dGranted = await createDashboardIn(page, fMain, `${PREFIX}_e_dash_granted`);
            dNeighbour = await createDashboardIn(page, fMain, `${PREFIX}_e_dash_neighbour`);
            dAway = await createDashboardIn(page, fAway, `${PREFIX}_e_dash_away`);
            if (!dGranted || !dNeighbour || !dAway) {
                throw new Error('dashboard seeding returned no id — the create response shape changed');
            }

            // Base role `user` carries nothing, so the custom role is the whole of each
            // account's access. `admin` would make every assertion pass for the wrong reason.
            for (const email of [U_STREAM, U_TYPE, U_PAIR, U_BASE, U_FOLDER, U_ITEM]) {
                await req(page, 'POST', '/users', {
                    email, password: MEMBER_PASSWORD,
                    first_name: 'IAM', last_name: 'Enforce', role: 'user',
                });
            }
            for (const [role, user] of [
                [R_STREAM, U_STREAM], [R_TYPE, U_TYPE], [R_PAIR, U_PAIR],
                [R_FOLDER, U_FOLDER], [R_ITEM, U_ITEM],
            ]) {
                await createRole(page, role);
                await req(page, 'PUT', `/roles/${role}`, {
                    add: [], remove: [], add_users: [user], remove_users: [],
                });
            }
            testLogger.info('enforcement fixtures ready');
        } finally {
            await page.close();
        }
    });

    test.beforeEach(async ({ page }) => {
        await navigateToBase(page);
        pm = new PageManager(page);
        // Capability is decided by the API, not by how fast a tab paints: a slow render
        // would otherwise turn a real test into a skip and still report green.
        test.skip(!(await rbacEnabled(page)), 'RBAC is off (OSS build)');
        await page.locator('[data-test="menu-link-\\/iam-item"]').click();
        await pm.rolesPage.rolesTab.waitFor({ state: 'visible', timeout: 30000 });
    });

    test.afterEach(async () => {
        for (const s of sessions) await s.context.close().catch(() => {});
        sessions = [];
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            for (const stream of [S_GRANTED, S_OTHER]) {
                await req(page, 'DELETE', `/streams/${stream}?type=logs`).catch(() => {});
            }
            await sweepDashboardFolders(page);
            const roles = await sweepRoles(page);
            const users = await sweepUsers(page);
            testLogger.info(`teardown removed ${roles.length} roles, ${users.length} users`);
            const left = [
                ...(await listRoles(page)).filter((r) => r.startsWith(PREFIX)),
                ...(await listUsers(page)).map((u) => u.email).filter((e) => e.startsWith(PREFIX)),
            ];
            if (left.length) throw new Error(`teardown left artifacts behind: ${left}`);
        } finally {
            await page.close();
        }
    });

    // ---------------- flow 1 ----------------

    test('E-01 · a stream granted in the editor opens for that user, and nothing else does', {
        tag: ['@iam', '@iamRolesEnforcement', '@P0', '@all']
    }, async ({ page, browser }) => {
        const base = await baseline(browser);
        expect(base.granted, 'an ungranted user could already read the stream — the fixture is wrong')
            .toBe(false);

        // Tick ONE stream's Get in the editor and save.
        await openRole(R_STREAM);
        await pm.rolesPage.openStreamType('logs');
        await pm.rolesPage.grantEntity(S_GRANTED, 'AllowGet');
        const payload = await pm.rolesPage.saveAndCapture();
        expect(payload?.add, 'the editor sent no grant').toEqual([
            { object: `logs:${S_GRANTED}`, permission: 'AllowGet' },
        ]);

        const user = await signIn(browser, U_STREAM);
        await expect.poll(async () => (await accessOf(user)).granted, { timeout: 30000 }).toBe(true);

        const got = await accessOf(user);
        expect(got.other, 'a grant on one stream leaked to another stream').toBe(false);
        expect(got.list, 'a single-stream grant allowed listing every stream').toBe(false);
    });

    // ---------------- flow 6 ----------------

    test('E-06 · unticking that grant returns the user to the empty-role baseline', {
        tag: ['@iam', '@iamRolesEnforcement', '@P0', '@all']
    }, async ({ page, browser }) => {
        const base = await baseline(browser);

        await openRole(R_STREAM);
        await pm.rolesPage.openStreamType('logs');
        await pm.rolesPage.grantEntity(S_GRANTED, 'AllowGet');
        await pm.rolesPage.saveAndCapture();

        const granted = await signIn(browser, U_STREAM);
        await expect.poll(async () => (await accessOf(granted)).granted, { timeout: 30000 }).toBe(true);

        // Untick the same box in the editor — the removal path, not an API delete.
        await openRole(R_STREAM, 1);
        await pm.rolesPage.openStreamType('logs');
        await pm.rolesPage.setCheckbox(pm.rolesPage.entityCheckbox(S_GRANTED, 'AllowGet'), false);
        const payload = await pm.rolesPage.saveAndCapture();
        expect(payload?.remove).toEqual([{ object: `logs:${S_GRANTED}`, permission: 'AllowGet' }]);

        // A fresh session: revocation must hold for a new sign-in, not merely after a
        // cache in the old one expires.
        const after = await signIn(browser, U_STREAM);
        await expect.poll(async () => await accessOf(after), { timeout: 30000 }).toEqual(base);
    });

    // ---------------- flow 4 ----------------

    test('E-04 · a type-level grant made in the editor opens that module and no other', {
        tag: ['@iam', '@iamRolesEnforcement', '@P0', '@all']
    }, async ({ page, browser }) => {
        await openRole(R_TYPE);
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.grantScope('function', 'AllowList');
        const payload = await pm.rolesPage.saveAndCapture();
        expect(payload?.add).toEqual([{ object: obj('function'), permission: 'AllowList' }]);

        const user = await signIn(browser, U_TYPE);
        await expect
            .poll(async () => allowed(await reqAs(user, 'GET', '/functions')), { timeout: 30000 })
            .toBe(true);

        // Streams are the neighbour that matters most: widening there is escalation.
        expect(allowed(await readList(user)), 'a function grant leaked into streams').toBe(false);
        expect(allowed(await reqAs(user, 'GET', '/alerts')), 'a function grant leaked into alerts').toBe(false);
    });

    // ---------------- flow 5 ----------------

    test('E-05 · of two grants saved together, removing one leaves the other working', {
        tag: ['@iam', '@iamRolesEnforcement', '@P0', '@all']
    }, async ({ page, browser }) => {
        // Both ticked before a single Save — the case a per-grant save would not cover.
        await openRole(R_PAIR);
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.grantScope('function', 'AllowList');
        await pm.rolesPage.openStreamType('logs');
        await pm.rolesPage.grantEntity(S_GRANTED, 'AllowGet');
        const saved = await pm.rolesPage.saveAndCapture();
        expect(saved?.add, 'the editor did not send both grants in one save').toHaveLength(2);

        const both = await signIn(browser, U_PAIR);
        await expect
            .poll(async () => allowed(await reqAs(both, 'GET', '/functions')), { timeout: 30000 })
            .toBe(true);
        expect(allowed(await readGranted(both)), 'the stream half of the pair never took effect').toBe(true);

        // Remove only the function grant, in the editor.
        await openRole(R_PAIR, 2);
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.revokeScope('function', 'AllowList');
        await pm.rolesPage.saveAndCapture();

        const after = await signIn(browser, U_PAIR);
        await expect
            .poll(async () => allowed(await reqAs(after, 'GET', '/functions')), { timeout: 30000 })
            .toBe(false);
        expect(allowed(await readGranted(after)), 'removing one grant revoked the other too').toBe(true);
    });

    // ---------------- flow 2 ----------------

    test('E-02 · List on a folder lists it; All on the folder also opens what is inside', {
        tag: ['@iam', '@iamRolesEnforcement', '@P0', '@all']
    }, async ({ page, browser }) => {
        const readFolder = (p) => reqAs(p, 'GET', `/dashboards?folder=${fMain}`);
        const openInside = (p) => reqAs(p, 'GET', `/dashboards/${dGranted}?folder=${fMain}`);
        const openAway = (p) => reqAs(p, 'GET', `/dashboards/${dAway}?folder=${fAway}`);

        // List on the folder row.
        await openRole(R_FOLDER);
        await pm.rolesPage.openModule('dfolder');
        await pm.rolesPage.grantEntity(fMain, 'AllowList');
        await pm.rolesPage.saveAndCapture();

        const listOnly = await signIn(browser, U_FOLDER);
        await expect.poll(async () => allowed(await readFolder(listOnly)), { timeout: 30000 }).toBe(true);
        expect(allowed(await openInside(listOnly)),
            'List on a folder was enough to OPEN a dashboard inside it').toBe(false);
        expect(allowed(await openAway(listOnly)),
            'a grant on one folder reached a dashboard in another').toBe(false);

        // Widen the same row to All.
        await openRole(R_FOLDER, 1);
        await pm.rolesPage.openModule('dfolder');
        await pm.rolesPage.grantEntity(fMain, 'AllowAll');
        await pm.rolesPage.saveAndCapture();

        const all = await signIn(browser, U_FOLDER);
        await expect.poll(async () => allowed(await openInside(all)), { timeout: 30000 }).toBe(true);
        expect(allowed(await readFolder(all)), 'All on a folder lost the listing List had').toBe(true);
        // The boundary that matters most: All is still folder-scoped.
        expect(allowed(await openAway(all)),
            'All on one folder reached a dashboard in another folder').toBe(false);
    });

    // ---------------- flow 3 ----------------

    test('E-03 · a grant on one dashboard opens only that dashboard', {
        tag: ['@iam', '@iamRolesEnforcement', '@P0', '@all']
    }, async ({ page, browser }) => {
        await openRole(R_ITEM);
        await pm.rolesPage.openModule('dfolder');
        await pm.rolesPage.openNode(fMain);
        await pm.rolesPage.grantEntity(dGranted, 'AllowGet');
        const payload = await pm.rolesPage.saveAndCapture();
        // The two-id shape: the item is addressed through its folder.
        expect(payload?.add?.[0]?.object).toBe(`dashboard:${fMain}/${dGranted}`);

        const user = await signIn(browser, U_ITEM);
        await expect
            .poll(async () => allowed(await reqAs(user, 'GET', `/dashboards/${dGranted}?folder=${fMain}`)),
                { timeout: 30000 })
            .toBe(true);

        expect(
            allowed(await reqAs(user, 'GET', `/dashboards/${dNeighbour}?folder=${fMain}`)),
            'a grant on one dashboard leaked to its neighbour in the same folder',
        ).toBe(false);
        expect(
            allowed(await reqAs(user, 'GET', `/dashboards?folder=${fMain}`)),
            'a single-dashboard grant allowed listing the whole folder',
        ).toBe(false);
    });
});
