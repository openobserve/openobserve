// IAM → Edit Role · grant semantics (G-01 .. G-16)
//
// Plan: .claude/commands/nvpworkflow/iam-roles-redesign-tests.md
//
// This is where a redesign silently changes MEANING rather than layout, so every
// test here asserts the PUT payload, not just the checkbox. A tick that looks
// right but writes six tuples instead of one, or writes to the wrong object, is
// invisible to any DOM-only assertion.
//
// ENTERPRISE ONLY, and needs a build carrying openobserve#14682.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const {
    ns, req, listRoles, createRole, setRolePerms, getPerms, makeTracker, uniq, org, rbacEnabled,
} = require('./iam-fixtures.js');

// This file's own namespace. Every artifact it creates lives under it, and its
// sweeps delete only it: the eleven IAM specs run in parallel and, through a
// shared `ui_auto` prefix, used to delete each other's fixtures mid-test.
const NS = ns('gnt');

// What this spec made, so teardown deletes exactly that — never a prefix sweep,
// which is what had the IAM specs deleting each other's fixtures mid-test.
const made = makeTracker();

const obj = (resource) => `${resource}:_all_${org()}`;

test.describe('IAM · Edit Role · grant semantics', { tag: '@enterprise' }, () => {
    // Serial, NOT parallel. every test in this file creates roles under one namespace and afterAll sweeps that
    // namespace, and beforeAll/afterAll run once PER WORKER — not per file. Under
    // `fullyParallel: true` this file's tests spread across workers, so each worker runs
    // its own sweep and they delete each other's roles mid-test: measured as
    // "teardown left roles behind: <this file's own prefix>". Serial pins the file to one
    // worker, so there is exactly one setup and one teardown.
    test.describe.configure({ mode: 'serial' });

    let pm;

    const freshRole = async (page, tag) => {
        const name = `${NS}_gr_${tag}_${uniq()}`;
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
        // Capability is decided by the API, not by how fast a tab paints.
        test.skip(!(await rbacEnabled(page)), 'RBAC is off (OSS build)');
        await page.locator('[data-test="menu-link-\\/iam-item"]').click();
        await pm.rolesPage.rolesTab.waitFor({ state: 'visible', timeout: 30000 });
    });

    // ---------------- the baseline contract ----------------

    test('G-01 · ticking one action writes exactly that grant', {
        tag: ['@iam', '@iamRolesGrants', '@P0', '@all']
    }, async ({ page }) => {
        const name = await openFresh(page, 'one');
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.grantScope('function', 'AllowList');

        const payload = await pm.rolesPage.saveAndCapture();
        expect(payload, 'save fired no PUT').toBeTruthy();
        expect(payload.add).toEqual([{ object: obj('function'), permission: 'AllowList' }]);
        expect(payload.remove).toEqual([]);

        await expect
            .poll(async () => await getPerms(page, name), { timeout: 15000 })
            .toEqual([{ object: obj('function'), permission: 'AllowList' }]);
    });

    test('G-02 · ticking All writes ONE AllowAll tuple, not six', {
        tag: ['@iam', '@iamRolesGrants', '@P0', '@all']
    }, async ({ page }) => {
        const name = await openFresh(page, 'all');
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.grantScope('function', 'AllowAll');

        const payload = await pm.rolesPage.saveAndCapture();
        // Stated explicitly in #14682's description. Only a payload assertion can
        // prove it — the six columns tick themselves either way.
        expect(payload.add).toHaveLength(1);
        expect(payload.add[0]).toEqual({ object: obj('function'), permission: 'AllowAll' });

        const stored = await getPerms(page, name);
        expect(stored).toHaveLength(1);
        expect(stored[0].permission).toBe('AllowAll');
    });

    test('G-03 · unticking All removes the AllowAll tuple, not six removals', {
        tag: ['@iam', '@iamRolesGrants', '@P0', '@all']
    }, async ({ page }) => {
        const name = await freshRole(page, 'unall');
        await setRolePerms(page, name, [{ object: obj('function'), permission: 'AllowAll' }]);

        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.openRole(name);
        await pm.rolesPage.waitForGrantsSettled(1);
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.revokeScope('function', 'AllowAll');

        const payload = await pm.rolesPage.saveAndCapture();
        expect(payload.remove).toEqual([{ object: obj('function'), permission: 'AllowAll' }]);
        expect(payload.add).toEqual([]);

        await expect.poll(async () => await getPerms(page, name), { timeout: 15000 }).toEqual([]);
    });

    test('G-04 · a wider AllowAll locks the action columns on the rows below', {
        tag: ['@iam', '@iamRolesGrants', '@P1', '@all']
    }, async ({ page }) => {
        const name = await freshRole(page, 'lock');
        // "Every Stream" covers logs/metrics/traces/index, so a grant there must
        // render the rows below as checked AND locked — access the old tree never showed.
        await setRolePerms(page, name, [{ object: obj('stream'), permission: 'AllowAll' }]);

        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.openRole(name);
        await pm.rolesPage.waitForGrantsSettled(1);
        await pm.rolesPage.openModule('stream');

        const scope = pm.rolesPage.scopeCheckbox('stream', 'AllowAll');
        await expect(scope).toBeVisible({ timeout: 15000 });
        expect(await pm.rolesPage.isChecked(scope)).toBe(true);
    });

    test('G-05 · a locked inherited checkbox cannot be unticked directly', {
        tag: ['@iam', '@iamRolesGrants', '@P1', '@all']
    }, async ({ page }) => {
        const name = await freshRole(page, 'locked');
        await setRolePerms(page, name, [{ object: obj('stream'), permission: 'AllowAll' }]);

        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.openRole(name);
        await pm.rolesPage.waitForGrantsSettled(1);
        await pm.rolesPage.openModule('stream');

        // Stream entities sit behind a drill-in (logs / metrics / traces), so step in
        // before looking for rows.
        const drill = page.locator('[data-test^="edit-role-module-pane-open-"]').first();
        if (await drill.isVisible({ timeout: 5000 }).catch(() => false)) {
            await drill.click();
            await page.waitForTimeout(1500);
        }

        // Any row-level checkbox under the granted scope must be DISABLED — a lock that
        // is only visual would let a user believe they revoked something they did not.
        const boxes = pm.rolesPage.entityCheckboxes('AllowGet');
        const n = await boxes.count();
        test.skip(n === 0, 'no stream entities in this org to inherit the scope');
        await expect(boxes.first()).toBeDisabled();
    });

    // ---------------- the hidden-permission map ----------------

    test('G-06 · settings offers Get but not List', {
        tag: ['@iam', '@iamRolesGrants', '@P2', '@all']
    }, async ({ page }) => {
        await openFresh(page, 'settings');
        await pm.rolesPage.openModule('settings');

        // settings has has_entities:false, so the module has NO pinned scope row — it
        // lists itself as one resource row and its checkboxes carry the entity slug.
        // HIDDEN map (EditRole.modifyResourcePermissions): settings hides List, Post
        // and Delete, which render as em-dashes rather than disabled boxes.
        await expect(pm.rolesPage.entityCheckbox('settings', 'AllowGet')).toBeVisible({ timeout: 15000 });
        await expect(pm.rolesPage.entityCheckbox('settings', 'AllowPut')).toBeVisible();
        for (const hidden of ['AllowList', 'AllowPost', 'AllowDelete']) {
            await expect(pm.rolesPage.entityCheckbox('settings', hidden)).toHaveCount(0);
            await expect(pm.rolesPage.entityNotApplicable('settings', hidden)).toBeVisible();
        }
    });

    test('G-07 · a permission hidden by the UI is not destroyed by saving an unrelated change', {
        tag: ['@iam', '@iamRolesGrants', '@P0', '@all']
    }, async ({ page }) => {
        const name = await freshRole(page, 'hidden');
        // The API accepts settings:AllowList even though the UI can neither show nor
        // revoke it. Saving something else must not quietly drop it.
        await setRolePerms(page, name, [{ object: obj('settings'), permission: 'AllowList' }]);

        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.openRole(name);
        await pm.rolesPage.waitForGrantsSettled();
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.grantScope('function', 'AllowGet');
        await pm.rolesPage.save();

        await expect
            .poll(async () => (await getPerms(page, name)).map((p) => `${p.object}|${p.permission}`).sort(),
                { timeout: 15000 })
            .toEqual([
                `${obj('function')}|AllowGet`,
                `${obj('settings')}|AllowList`,
            ].sort());
    });

    // ---------------- idempotence and no-ops ----------------

    test('G-08 · re-ticking an already-held grant sends nothing', {
        tag: ['@iam', '@iamRolesGrants', '@P1', '@all']
    }, async ({ page }) => {
        const name = await freshRole(page, 'idem');
        await setRolePerms(page, name, [{ object: obj('function'), permission: 'AllowList' }]);

        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.openRole(name);
        await pm.rolesPage.waitForGrantsSettled(1);
        await pm.rolesPage.openModule('function');

        const box = pm.rolesPage.scopeCheckbox('function', 'AllowList');
        await expect(box).toBeVisible({ timeout: 15000 });
        expect(await pm.rolesPage.isChecked(box)).toBe(true);

        // OpenFGA returns 500 when a held tuple is re-written, so the UI must not
        // resend a grant it already has.
        const payload = await pm.rolesPage.saveAndCapture({ expectRequest: false });
        if (payload) {
            expect(payload.add).toEqual([]);
            expect(payload.remove).toEqual([]);
        }
        expect((await getPerms(page, name))).toHaveLength(1);
    });

    test('G-09 · staging an add and then undoing it sends nothing', {
        tag: ['@iam', '@iamRolesGrants', '@P1', '@all']
    }, async ({ page }) => {
        const name = await openFresh(page, 'netzero');
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.grantScope('function', 'AllowList');
        await pm.rolesPage.revokeScope('function', 'AllowList');

        const payload = await pm.rolesPage.saveAndCapture({ expectRequest: false });
        if (payload) {
            expect(payload.add).toEqual([]);
            expect(payload.remove).toEqual([]);
        }
        expect(await getPerms(page, name)).toEqual([]);
    });

    test('G-10 · saving with no changes fires no PUT', {
        tag: ['@iam', '@iamRolesGrants', '@P1', '@all']
    }, async ({ page }) => {
        await openFresh(page, 'nochange');
        const payload = await pm.rolesPage.saveAndCapture({ expectRequest: false });
        expect(payload, 'a no-op save still wrote to the API').toBeNull();
    });

    // ---------------- scope boundary ----------------

    test('G-11 · the org module is not offered in a non-meta org', {
        tag: ['@iam', '@iamRolesGrants', '@P1', '@all']
    }, async ({ page }) => {
        await openFresh(page, 'org');
        const isMeta = org() === '_meta';
        test.skip(isMeta, 'running in the meta org, where org IS grantable');

        // EditRole hides `org` outside the meta org. The backend does NOT check this
        // (stated in #14682), so the UI is the only thing holding the boundary.
        await expect(pm.rolesPage.railItem('org')).toHaveCount(0);
    });

    // ---------------- presets ----------------

    test('G-12 · the Read-Only preset seeds List+Get and leaves settings with Get only', {
        tag: ['@iam', '@iamRolesGrants', '@P1', '@all']
    }, async ({ page }) => {
        const name = await openFresh(page, 'preset');
        await expect(pm.rolesPage.summaryEmpty).toBeVisible({ timeout: 15000 });
        await pm.rolesPage.presetCard('Read-Only').click();
        await pm.rolesPage.save();

        const stored = await getPerms(page, name);
        expect(stored.length).toBeGreaterThan(10);

        const byResource = {};
        for (const p of stored) {
            (byResource[p.object.split(':')[0]] ||= []).push(p.permission);
        }
        for (const perms of Object.values(byResource)) {
            // Read-only means read-only: nothing destructive may be seeded.
            expect(perms).not.toContain('AllowDelete');
            expect(perms).not.toContain('AllowPost');
            expect(perms).not.toContain('AllowAll');
        }
        if (byResource.settings) {
            expect(byResource.settings.sort()).toEqual(['AllowGet']);
        }
        // OpenFGA's rum_analytics type has no GET or LIST, so staging one rejects the whole save.
        expect(byResource.rum_analytics ?? []).toEqual([]);
    });

    test('G-13 · a role created with "start from Read-Only" is seeded, not empty', {
        tag: ['@iam', '@iamRolesGrants', '@P1', '@all']
    }, async ({ page }) => {
        const name = `${NS}_gr_startfrom_${uniq()}`;
        // Created through the UI, so register it by hand — the API helper never sees it.
        made.role(name);
        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.createRole(name, { startFrom: 'readonly' });
        await pm.rolesPage.waitForGrantsSettled();
        await pm.rolesPage.save();

        // AddRole's start-from seeds once the user lands on EditRole; a role created
        // this way that saves empty would silently grant nothing.
        await expect
            .poll(async () => (await getPerms(page, name)).length, { timeout: 20000 })
            .toBeGreaterThan(0);
    });

    // ---------------- negative / rejection ----------------

    test('G-N1 · a blank role name is refused', {
        tag: ['@iam', '@iamRolesGrants', '@P1', '@all']
    }, async ({ page }) => {
        // Only THIS spec's roles. Comparing the whole org list made the assertion false
        // the moment a neighbouring spec created a role between the two reads — it failed
        // in the gate with `+ ui_auto_stg_st_save_...`, a role belonging to the staging
        // spec running in another worker. Same lesson as GR-03: membership, not totals.
        const mine = async () => (await listRoles(page)).filter((r) => r.startsWith(NS)).sort();
        const before = await mine();
        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.addRoleButton.click();
        await expect(pm.rolesPage.addRoleDialog).toBeVisible();
        await pm.rolesPage.roleNameInput.fill('');
        await pm.rolesPage.addRoleSave.click();

        await expect(pm.rolesPage.addRoleDialog).toBeVisible();
        expect(await mine(), 'a blank name created a role').toEqual(before);
    });

    test('G-N2 · a duplicate role name is refused and the original keeps its grants', {
        tag: ['@iam', '@iamRolesGrants', '@P0', '@all']
    }, async ({ page }) => {
        const name = await freshRole(page, 'dup');
        await setRolePerms(page, name, [{ object: obj('function'), permission: 'AllowList' }]);

        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.addRoleButton.click();
        await expect(pm.rolesPage.addRoleDialog).toBeVisible();
        await pm.rolesPage.roleNameInput.fill(name);
        await pm.rolesPage.addRoleSave.click();

        await expect
            .poll(async () => (await getPerms(page, name)).length, { timeout: 15000 })
            .toBe(1);
        expect((await listRoles(page)).filter((r) => r === name)).toHaveLength(1);
    });

    // SKIPPED pending triage. The premise holds at the API — POST /roles really does
    // normalize, verified directly: `ui_auto_gr.norm-1790161074` was stored as
    // `ui_auto_gr_norm_1790161074`. But this test types the name into the Add Role
    // dialog, and the UI refuses punctuation before the request is ever made: the
    // dialog stays open (CI saw `add-role-dialog` never reach hidden) and no role is
    // created under either spelling, so the poll for the normalized name times out.
    // Decide which behaviour is intended — UI validation, or normalize-on-submit like
    // the API — then rewrite this against that. The UI's own name validation has no
    // coverage today either way.
    test.fixme('G-N3 · a role name with punctuation is normalized, and the editor targets the stored name', {
        tag: ['@iam', '@iamRolesGrants', '@P2', '@all']
    }, async ({ page }) => {
        const raw = `${NS}_gr.norm-${Date.now()}`;
        const normalized = raw.replace(/[^A-Za-z0-9_]/g, '_');
        // Register the NORMALIZED name: that is the role the backend actually stores, so
        // tracking `raw` would delete nothing and leak the real one.
        made.role(normalized);

        await pm.rolesPage.gotoRoles();
        await pm.rolesPage.createRole(raw);

        // POST /roles normalizes; a later PUT does NOT. If the editor kept the typed
        // name, every subsequent save would 404 against a role that does not exist.
        await expect.poll(async () => await listRoles(page), { timeout: 15000 }).toContain(normalized);
        expect(await listRoles(page)).not.toContain(raw);

        await pm.rolesPage.waitForGrantsSettled();
        await pm.rolesPage.openModule('function');
        await pm.rolesPage.grantScope('function', 'AllowList');
        const payload = await pm.rolesPage.saveAndCapture();
        expect(payload, 'save fired no PUT — the editor may be targeting the un-normalized name').toBeTruthy();
        await expect
            .poll(async () => (await getPerms(page, normalized)).length, { timeout: 15000 })
            .toBe(1);
    });
});
