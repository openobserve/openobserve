// IAM → Edit Role · saved object format (O-01 .. O-06, O-B1)
//
// Plan: .claude/commands/nvpworkflow/iam-roles-redesign-tests.md (Wave 2, flows 7-11)
//
// The grants spec samples the object string on flat resources. These pin its SHAPE
// for every kind of item, because the shapes genuinely differ and the editor has to
// know which is which:
//
//   dashboard / alert / report    `<type>:<folderId>/<itemId>`   folder in the object
//   synthetics / workflows        `<type>:<itemId>`              folder NOT in the object
//   logs / metrics / traces / index   `<type>:<streamName>`      own type per stream
//   "Every Stream"                `stream:_all_<org>`
//
// synthetics and workflows are parented to folders in OpenFGA (mapping.rs) yet save
// flat — useRoleJsonView.ts has to SEARCH the folders to find which one holds an id
// ("Plain-id entity"). An editor that "helpfully" added the folder would break them,
// and only a payload assertion catches it.
//
// Rows are matched by their data-test PREFIX rather than by a guessed id, so these
// stay true whether a row is slugged by id or by title. The assertion is on the
// object's shape, which is what the flow is about.
//
// ENTERPRISE ONLY, and needs a build carrying openobserve#14682.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const {
    ns, req, listRoles, createRole, setRolePerms, getPerms, makeTracker, uniq, org, rbacEnabled,
    createDashboardFolder, createDashboardIn,
} = require('./iam-fixtures.js');

// This file's own namespace. Every artifact it creates lives under it, and its
// sweeps delete only it: the eleven IAM specs run in parallel and, through a
// shared `ui_auto` prefix, used to delete each other's fixtures mid-test.
const NS = ns('obj');

// What this spec made, so teardown deletes exactly that — never a prefix sweep,
// which is what had the IAM specs deleting each other's fixtures mid-test.
const made = makeTracker();

const obj = (resource) => `${resource}:_all_${org()}`;

const F_OBJ = `${NS}_o_folder`;
let fid;

// One logs stream is enough: O-04 only needs a single stream whose saved object must
// carry the `logs:` prefix rather than collapsing onto `stream:`. ("Every Stream" is
// asserted on the pinned scope row in the same test, which needs no fixture.)
const S_LOG = `${NS}_o_log`;

test.describe('IAM · Edit Role · saved object format', { tag: '@enterprise' }, () => {
    // Serial, NOT parallel. the dashboard folder and log stream are made once in beforeAll and shared.
    // `fullyParallel: true` races individual TESTS, so the per-file namespaces in
    // iam-fixtures.js only stop files colliding — this stops a file colliding with
    // itself. Cost: a failure here skips the rest of the file rather than running them.
    test.describe.configure({ mode: 'serial' });

    let pm;

    const freshRole = async (page, tag) => {
        const name = `${NS}_ob_${tag}_${uniq()}`;
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

    /** Ticks the first resource row in the open pane and returns the PUT payload. */
    const tickFirstRowAndSave = async (page, action = 'AllowGet') => {
        const boxes = pm.rolesPage.entityCheckboxes(action);
        await expect.poll(async () => await boxes.count(), { timeout: 20000 }).toBeGreaterThan(0);
        await pm.rolesPage.setCheckbox(boxes.first(), true);
        return await pm.rolesPage.saveAndCapture();
    };

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {

            fid = made.folder(await createDashboardFolder(page, F_OBJ));
            await createDashboardIn(page, fid, `${NS}_o_dash`);

            await req(page, 'POST', `/${S_LOG}/_json`, [
                { _timestamp: Date.now() * 1000, level: 'info', msg: 'object format seed' },
            ]);
            await expect
                .poll(async () => (await req(page, 'GET', `/streams/${S_LOG}/schema?type=logs`)).status,
                    { timeout: 30000, intervals: [500, 1000, 2000] })
                .toBeLessThan(400);

            testLogger.info('object-format fixtures ready');
        } finally {
            await page.close();
        }
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await req(page, 'DELETE', `/streams/${S_LOG}?type=logs`).catch(() => {});
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

    // ---------------- flow 7 ----------------

    test('O-01 · an item inside a folder saves as <type>:<folderId>/<itemId>', {
        tag: ['@iam', '@iamRolesObjects', '@P0', '@all']
    }, async ({ page }) => {
        await openFresh(page, 'dash');
        await pm.rolesPage.openModule('dfolder');
        await pm.rolesPage.openNode(fid);

        const payload = await tickFirstRowAndSave(page);
        expect(payload, 'save fired no PUT').toBeTruthy();
        expect(payload.add).toHaveLength(1);

        // The folder id must be IN the object, and the item id after it.
        expect(payload.add[0].object).toMatch(new RegExp(`^dashboard:${fid}/.+$`));
        expect(payload.add[0].permission).toBe('AllowGet');
    });

    test('O-02 · a grant on the folder itself carries no item part', {
        tag: ['@iam', '@iamRolesObjects', '@P1', '@all']
    }, async ({ page }) => {
        const name = await openFresh(page, 'dfold');
        await pm.rolesPage.openModule('dfolder');

        // The pinned scope row is the folder TYPE; a row grant is one folder.
        const boxes = pm.rolesPage.entityCheckboxes('AllowList');
        await expect.poll(async () => await boxes.count(), { timeout: 20000 }).toBeGreaterThan(0);
        await pm.rolesPage.setCheckbox(boxes.first(), true);
        const payload = await pm.rolesPage.saveAndCapture();

        expect(payload.add).toHaveLength(1);
        // `dfolder:<id>` — no slash, because a folder has no parent folder.
        expect(payload.add[0].object).toMatch(/^dfolder:[^/]+$/);

        await expect
            .poll(async () => (await getPerms(page, name)).map((p) => p.object), { timeout: 15000 })
            .toEqual([payload.add[0].object]);
    });

    // ---------------- flow 8 ----------------

    test('O-03 · a workflow saves as a plain id, with no folder part', {
        tag: ['@iam', '@iamRolesObjects', '@P0', '@all']
    }, async ({ page }) => {
        await openFresh(page, 'wf');

        const hasModule = await pm.rolesPage.railItem('workflow_folder')
            .isVisible({ timeout: 10000 }).catch(() => false);
        test.skip(!hasModule, 'workflow folders not present in this org');

        await pm.rolesPage.openModule('workflow_folder');
        const folders = pm.rolesPage.page.locator('[data-test^="edit-role-module-pane-open-"]');
        const n = await folders.count();
        test.skip(n === 0, 'no workflow folder to descend into');
        await folders.first().click();
        await expect(pm.rolesPage.paneBack).toBeVisible({ timeout: 15000 });

        const boxes = pm.rolesPage.entityCheckboxes('AllowGet');
        test.skip(await boxes.count() === 0, 'no workflow in this folder to grant');
        await pm.rolesPage.setCheckbox(boxes.first(), true);
        const payload = await pm.rolesPage.saveAndCapture();

        // The asymmetry this test exists for: parented in OpenFGA, flat in the object.
        expect(payload.add).toHaveLength(1);
        expect(payload.add[0].object).toMatch(/^workflows:[^/]+$/);
    });

    // ---------------- flow 9 ----------------

    test('O-04 · each stream type saves under its own type, and Every Stream saves as _all_', {
        tag: ['@iam', '@iamRolesObjects', '@P0', '@all']
    }, async ({ page }) => {
        const name = await openFresh(page, 'stream');
        await pm.rolesPage.openModule('stream');

        // "Every Stream" is the pinned scope row on the stream module.
        await pm.rolesPage.grantScope('stream', 'AllowList');
        const wide = await pm.rolesPage.saveAndCapture();
        expect(wide.add).toEqual([{ object: obj('stream'), permission: 'AllowList' }]);

        // A single logs stream is keyed on its OWN type, not on `stream:`.
        const second = await freshRole(page, 'logs');
        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.openRole(second);
        await pm.rolesPage.waitForGrantsSettled(0);
        // The individual streams live one level inside the stream module, under their type.
        await pm.rolesPage.openStreamType('logs');

        const payload = await tickFirstRowAndSave(page);
        expect(payload.add).toHaveLength(1);
        expect(payload.add[0].object).toMatch(/^logs:[^/]+$/);
        expect(payload.add[0].object, 'a logs stream was saved under the stream type')
            .not.toContain('_all_');
        void name;
    });

    // ---------------- flow 10 ----------------

    test('O-05 · a second save in the same session sends only what changed after the first', {
        tag: ['@iam', '@iamRolesObjects', '@P0', '@all']
    }, async ({ page }) => {
        const name = await openFresh(page, 'twice');
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.grantScope('function', 'AllowList');

        const first = await pm.rolesPage.saveAndCapture();
        expect(first.add).toEqual([{ object: obj('function'), permission: 'AllowList' }]);

        // Second change, same page — the editor must not resend the first grant.
        await pm.rolesPage.openModule('pipeline');
        await pm.rolesPage.grantScope('pipeline', 'AllowList');

        const second = await pm.rolesPage.saveAndCapture();
        expect(second.add).toEqual([{ object: obj('pipeline'), permission: 'AllowList' }]);
        expect(second.add, 'the second save resent the first grant').toHaveLength(1);
        expect(second.remove).toEqual([]);

        await expect
            .poll(async () => (await getPerms(page, name)).length, { timeout: 15000 })
            .toBe(2);
    });

    // ---------------- flow 11 ----------------

    test('O-06 · undoing a staged grant on an item inside a folder removes exactly that grant', {
        tag: ['@iam', '@iamRolesObjects', '@P1', '@all']
    }, async ({ page }) => {
        await openFresh(page, 'undo');
        await pm.rolesPage.openModule('dfolder');
        await pm.rolesPage.openNode(fid);

        const boxes = pm.rolesPage.entityCheckboxes('AllowGet');
        await expect.poll(async () => await boxes.count(), { timeout: 20000 }).toBeGreaterThan(0);
        await pm.rolesPage.setCheckbox(boxes.first(), true);

        // Also stage something elsewhere, so "exactly that grant" is a real claim.
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.grantScope('function', 'AllowList');
        await expect(pm.rolesPage.unsavedCount).toContainText('2', { timeout: 15000 });

        await pm.rolesPage.openDrawer();

        // Undo the folder-item one from the drawer, by its own row.
        const undos = pm.rolesPage.drawerUndoButtons();
        const ids = await undos.evaluateAll((els) => els.map((e) => e.getAttribute('data-test')));
        // The drawer slugs a change as `edit-role-unsaved-undo-<resource>-<entity>-<kind>`
        // — a DASH after the resource, not the object's colon. Observed in CI:
        // `...-undo-dashboard-7511309722683703296/7511309722725646336-added`.
        const target = ids.find((id) => id && /-undo-dashboard[-:]/.test(id));
        expect(target, `no dashboard change in the drawer: ${ids}`).toBeTruthy();
        await page.locator(`[data-test="${target}"]`).click();

        // The function grant must survive; only the dashboard one goes.
        await expect(pm.rolesPage.unsavedCount).toContainText('1', { timeout: 15000 });
        // The drawer only self-closes once nothing is staged; with one change left it
        // stays open and its overlay swallows the click on Save.
        await pm.rolesPage.closeDrawer();
        const payload = await pm.rolesPage.saveAndCapture();
        expect(payload.add).toEqual([{ object: obj('function'), permission: 'AllowList' }]);
    });

    // ---------------- known bug: flow 28 ----------------

    // FAILS TODAY, by design — a record of the bug, not a wish.
    //
    // Switching to the JSON view before the role's own grants have finished loading
    // and then saving drops the grants that were already stored. The editor builds the
    // JSON from state that is still empty, and the save treats that emptiness as the
    // user's intent — so a role silently loses permissions nobody touched.
    //
    // Data loss, and the most serious of the three Wave 2 defects. NEEDS AN
    // o2-enterprise ISSUE; put its number in this title, as U-14 and GR-04 do.
    test.fixme('O-B1 · switching to JSON before grants load must not drop saved grants', {
        tag: ['@iam', '@iamRolesObjects', '@P0', '@bug', '@all']
    }, async ({ page }) => {
        const name = await freshRole(page, 'jsonload');
        const seeded = [
            { object: obj('function'), permission: 'AllowList' },
            { object: obj('pipeline'), permission: 'AllowList' },
        ];
        await setRolePerms(page, name, seeded);

        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.openRole(name);
        // Deliberately do NOT wait for the grants to settle — that is the bug's window.
        await pm.rolesPage.showJsonButton.click();
        await pm.rolesPage.saveButton.click();
        await page.waitForTimeout(3000);

        const stored = await getPerms(page, name);
        expect(stored, 'saving from the JSON view mid-load destroyed stored grants')
            .toHaveLength(seeded.length);
    });
});
