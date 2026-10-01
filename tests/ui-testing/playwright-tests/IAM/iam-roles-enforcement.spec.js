// IAM → Edit Role · enforcement (E-01 .. E-06)
//
// Plan: .claude/commands/nvpworkflow/iam-roles-redesign-tests.md (Wave 2, flows 1-6)
//
// The grants specs prove the editor WRITES the right tuple. These prove the tuple
// MEANS something: a real non-root user's access must match the grant exactly, and
// must come back to the empty-role baseline when the grant goes away.
//
// Two rules make the difference between a real test and a green one:
//
//  1. Every access assertion goes through reqAs(), never req(). req() attaches root
//     Basic auth, and root bypasses authorization — the assertion would pass whatever
//     the role said. See the comment on reqAs in iam-fixtures.js.
//  2. Each user's access is compared against a BASELINE captured from an ungranted
//     account, not against a hardcoded status. "Denied" differs by endpoint (403 vs
//     404 vs 400) and the baseline is the only thing that stays true if that changes.
//
// ENTERPRISE ONLY (rbac_enabled). Artifacts are namespaced `ui_auto_*`.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const {
    PREFIX, req, reqAs, allowed, listRoles, listUsers, createRole, setRolePerms,
    sweepRoles, sweepUsers, loginAs, MEMBER_PASSWORD, uniq, org,
    createDashboardFolder, createDashboardIn, sweepDashboardFolders,
} = require('./iam-fixtures.js');

const obj = (resource) => `${resource}:_all_${org()}`;

// Two logs streams, so "can read the one I was granted" is distinguishable from
// "can read any stream". A single stream cannot tell those apart.
const S_GRANTED = `${PREFIX}_e_s_granted`;
const S_OTHER = `${PREFIX}_e_s_other`;

const U_STREAM = `${PREFIX}_e_stream@example.com`;   // one stream, by name
const U_TYPE = `${PREFIX}_e_type@example.com`;       // a whole module
const U_PAIR = `${PREFIX}_e_pair@example.com`;       // two grants, one removed later
const U_BASE = `${PREFIX}_e_base@example.com`;       // nothing, ever — the baseline

const U_FOLDER = `${PREFIX}_e_folder@example.com`;   // a whole dashboard folder
const U_ITEM = `${PREFIX}_e_item@example.com`;       // one dashboard inside a folder

const R_FOLDER = `${PREFIX}_e_role_folder`;
const R_ITEM = `${PREFIX}_e_role_item`;

// One folder holding two dashboards, plus a dashboard in a second folder. Both
// halves are needed: the neighbour proves a grant does not widen within a folder,
// the other folder proves it does not widen across folders.
const F_MAIN = `${PREFIX}_e_folder_main`;
const F_AWAY = `${PREFIX}_e_folder_away`;
let fMain, fAway, dGranted, dNeighbour, dAway;

const R_STREAM = `${PREFIX}_e_role_stream`;
const R_TYPE = `${PREFIX}_e_role_type`;
const R_PAIR = `${PREFIX}_e_role_pair`;

// The three reads flow 1 distinguishes. Kept as thunks so the baseline and the
// granted user run byte-identical requests.
const readGranted = (page) => reqAs(page, 'GET', `/streams/${S_GRANTED}/schema?type=logs`);
const readOther = (page) => reqAs(page, 'GET', `/streams/${S_OTHER}/schema?type=logs`);
const readList = (page) => reqAs(page, 'GET', '/streams?type=logs');

let sessions = [];
const signIn = async (browser, email) => {
    const s = await loginAs(browser, email, MEMBER_PASSWORD);
    sessions.push(s);
    return s.page;
};

/** What an account with no grants at all can do. Everything else is compared to this. */
const baseline = async (browser) => {
    const page = await signIn(browser, U_BASE);
    return {
        granted: allowed(await readGranted(page)),
        other: allowed(await readOther(page)),
        list: allowed(await readList(page)),
    };
};

const accessOf = async (page) => ({
    granted: allowed(await readGranted(page)),
    other: allowed(await readOther(page)),
    list: allowed(await readList(page)),
});

test.describe('IAM · Edit Role · enforcement', { tag: '@enterprise' }, () => {
    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await sweepRoles(page);
            await sweepUsers(page);

            const probe = await req(page, 'GET', '/roles');
            test.skip(probe.status === 403 || probe.status === 404, 'roles API unavailable — RBAC off');

            // Ingest so both streams exist and carry a schema; a grant on a stream the
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

            // Base role `user` carries nothing, so the custom role is the whole of
            // each account's access. `admin` would make every assertion pass for the
            // wrong reason.
            fMain = await createDashboardFolder(page, F_MAIN);
            fAway = await createDashboardFolder(page, F_AWAY);
            dGranted = await createDashboardIn(page, fMain, `${PREFIX}_e_dash_granted`);
            dNeighbour = await createDashboardIn(page, fMain, `${PREFIX}_e_dash_neighbour`);
            dAway = await createDashboardIn(page, fAway, `${PREFIX}_e_dash_away`);
            if (!dGranted || !dNeighbour || !dAway) {
                throw new Error('dashboard seeding returned no id — the create response shape changed');
            }

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

    test('E-01 · a grant on one stream opens that stream and nothing else', {
        tag: ['@iam', '@iamRolesEnforcement', '@P0', '@all']
    }, async ({ browser }) => {
        const base = await baseline(browser);
        expect(base.granted, 'an ungranted user could already read the stream — fixture is wrong').toBe(false);

        const root = await browser.newPage();
        try {
            await setRolePerms(root, R_STREAM, [{ object: `logs:${S_GRANTED}`, permission: 'AllowGet' }]);

            const page = await signIn(browser, U_STREAM);
            await expect.poll(async () => (await accessOf(page)).granted, { timeout: 20000 }).toBe(true);

            const withGrant = await accessOf(page);
            expect(withGrant.other, 'a grant on one stream leaked to another stream').toBe(false);
            expect(withGrant.list, 'a single-stream grant allowed listing every stream').toBe(false);
        } finally {
            await root.close();
        }
    });

    test('E-06 · removing the grant returns access to the empty-role baseline', {
        tag: ['@iam', '@iamRolesEnforcement', '@P0', '@all']
    }, async ({ browser }) => {
        const base = await baseline(browser);

        const root = await browser.newPage();
        try {
            const grant = [{ object: `logs:${S_GRANTED}`, permission: 'AllowGet' }];
            await setRolePerms(root, R_STREAM, grant);

            const granted = await signIn(browser, U_STREAM);
            await expect.poll(async () => (await accessOf(granted)).granted, { timeout: 20000 }).toBe(true);

            await setRolePerms(root, R_STREAM, [], grant);

            // A fresh session: revocation must hold for a new sign-in, not merely
            // after a cache in the old one happens to expire.
            const after = await signIn(browser, U_STREAM);
            await expect
                .poll(async () => await accessOf(after), { timeout: 30000 })
                .toEqual(base);
        } finally {
            await root.close();
        }
    });

    // ---------------- flow 4 ----------------

    test('E-04 · a type-level grant opens that whole module and no other', {
        tag: ['@iam', '@iamRolesEnforcement', '@P0', '@all']
    }, async ({ browser }) => {
        const root = await browser.newPage();
        try {
            // "All Functions: List" — the whole type, by the _all_ object.
            await setRolePerms(root, R_TYPE, [{ object: obj('function'), permission: 'AllowList' }]);

            const page = await signIn(browser, U_TYPE);
            await expect
                .poll(async () => allowed(await reqAs(page, 'GET', '/functions')), { timeout: 20000 })
                .toBe(true);

            // Nothing in other modules. Streams are the neighbour that matters most:
            // a type grant that widened to them would be a privilege escalation.
            expect(allowed(await readList(page)), 'a function grant leaked into streams').toBe(false);
            expect(allowed(await reqAs(page, 'GET', '/alerts')), 'a function grant leaked into alerts').toBe(false);
        } finally {
            await root.close();
        }
    });

    // ---------------- flow 5 ----------------

    test('E-05 · of two grants saved together, removing one leaves the other working', {
        tag: ['@iam', '@iamRolesEnforcement', '@P0', '@all']
    }, async ({ browser }) => {
        const root = await browser.newPage();
        try {
            const fnGrant = { object: obj('function'), permission: 'AllowList' };
            const streamGrant = { object: `logs:${S_GRANTED}`, permission: 'AllowGet' };
            // One save carrying both, which is the case a per-grant save would not cover.
            await setRolePerms(root, R_PAIR, [fnGrant, streamGrant]);

            const both = await signIn(browser, U_PAIR);
            await expect
                .poll(async () => allowed(await reqAs(both, 'GET', '/functions')), { timeout: 20000 })
                .toBe(true);
            expect(allowed(await readGranted(both)), 'the stream half of the pair never took effect').toBe(true);

            await setRolePerms(root, R_PAIR, [], [fnGrant]);

            const after = await signIn(browser, U_PAIR);
            await expect
                .poll(async () => allowed(await reqAs(after, 'GET', '/functions')), { timeout: 30000 })
                .toBe(false);
            // The point of the test: removing one grant must not disturb the other.
            expect(allowed(await readGranted(after)), 'removing one grant revoked the other too').toBe(true);
        } finally {
            await root.close();
        }
    });

    // ---------------- flow 2 ----------------

    test('E-02 · List on a folder lists it, All on the folder also opens what is inside', {
        tag: ['@iam', '@iamRolesEnforcement', '@P0', '@all']
    }, async ({ browser }) => {
        const readFolder = (page) => reqAs(page, 'GET', `/dashboards?folder=${fMain}`);
        const openInside = (page) => reqAs(page, 'GET', `/dashboards/${dGranted}?folder=${fMain}`);
        const openAway = (page) => reqAs(page, 'GET', `/dashboards/${dAway}?folder=${fAway}`);

        const root = await browser.newPage();
        try {
            // List on the folder: see the folder's contents listed, but not open one.
            const listGrant = [{ object: `dfolder:${fMain}`, permission: 'AllowList' }];
            await setRolePerms(root, R_FOLDER, listGrant);

            const listOnly = await signIn(browser, U_FOLDER);
            await expect.poll(async () => allowed(await readFolder(listOnly)), { timeout: 20000 }).toBe(true);
            expect(allowed(await openInside(listOnly)),
                'List on a folder was enough to OPEN a dashboard inside it').toBe(false);
            expect(allowed(await openAway(listOnly)),
                'a grant on one folder reached a dashboard in another').toBe(false);

            // All on the same folder: both the listing and the contents.
            await setRolePerms(root, R_FOLDER, [{ object: `dfolder:${fMain}`, permission: 'AllowAll' }], listGrant);

            const all = await signIn(browser, U_FOLDER);
            await expect.poll(async () => allowed(await openInside(all)), { timeout: 30000 }).toBe(true);
            expect(allowed(await readFolder(all)), 'All on a folder lost the listing it had with List').toBe(true);
            // The boundary that matters most: All is still folder-scoped.
            expect(allowed(await openAway(all)),
                'All on one folder reached a dashboard in another folder').toBe(false);
        } finally {
            await root.close();
        }
    });

    // ---------------- flow 3 ----------------

    test('E-03 · a grant on one dashboard opens only that dashboard', {
        tag: ['@iam', '@iamRolesEnforcement', '@P0', '@all']
    }, async ({ browser }) => {
        const root = await browser.newPage();
        try {
            // The two-id object shape: the item is addressed through its folder.
            await setRolePerms(root, R_ITEM, [
                { object: `dashboard:${fMain}/${dGranted}`, permission: 'AllowGet' },
            ]);

            const page = await signIn(browser, U_ITEM);
            await expect
                .poll(async () => allowed(await reqAs(page, 'GET', `/dashboards/${dGranted}?folder=${fMain}`)),
                    { timeout: 20000 })
                .toBe(true);

            expect(
                allowed(await reqAs(page, 'GET', `/dashboards/${dNeighbour}?folder=${fMain}`)),
                'a grant on one dashboard leaked to its neighbour in the same folder',
            ).toBe(false);
            expect(
                allowed(await reqAs(page, 'GET', `/dashboards?folder=${fMain}`)),
                'a single-dashboard grant allowed listing the whole folder',
            ).toBe(false);
        } finally {
            await root.close();
        }
    });
});
