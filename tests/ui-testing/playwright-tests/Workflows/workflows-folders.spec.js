/**
 * Workflow folders — UI coverage (WFF-UI-01 .. WFF-UI-13)
 *
 * Feature: folders for Workflows + folder-scoped RBAC, merged as 8bd20ac96c (#14421).
 * Plan: .claude/commands/nvpworkflow/workflow-folders-automation.md
 *
 * Enterprise-only, like the rest of the Workflows suite: no runtime availability skip —
 * if the feature is missing where this runs, it must fail loudly.
 *
 * Fixtures are seeded through the REST API (workflowFolderSeed.js) rather than built on the
 * canvas: these tests assert listing/scoping/moving, and the canvas paths need a live
 * destination the SSRF guard refuses to create on *.common-dev envs.
 *
 * Self-cleaning: everything is namespaced `wf_auto_fld_*` and torn down in afterAll; a folder
 * is purged before it is deleted, because a folder holding a workflow or a draft refuses to go.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const seed = require('../../pages/workflowsPages/workflowFolderSeed.js');

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

const RUN = uniq();
const FOLDER_A = `wf_auto_fld_a_${RUN}`;
const FOLDER_B = `wf_auto_fld_b_${RUN}`;

test.describe('Workflow folders', { tag: ['@workflows', '@workflowFolders', '@enterprise', '@all'] }, () => {
  // Serial: the specs share one pair of folders and move workflows between them, so a
  // parallel run would have one test's move invalidate another's listing assertion.
  test.describe.configure({ mode: 'serial' });

  let pm;
  let ctx; // ids seeded once for the whole file

  // Seeding only — `page.request` carries explicit Basic auth headers, so this needs no UI
  // navigation. navigateToBase() must NOT be used here: it calls page.waitHelpers, which the
  // custom test fixture attaches to the fixture-provided page and a raw newPage() lacks.
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const destName = `wf_auto_fld_dest_${RUN}`;
    await seed.createPipelineDestination(page, destName);
    ctx = {
      destName,
      folderA: await seed.createFolder(page, FOLDER_A),
      folderB: await seed.createFolder(page, FOLDER_B),
      workflows: [],
      // Inline-created folders (UI rename/create, delete-guard) are swept here
      // too, so a test that fails mid-run cannot leak them.
      folders: [],
    };
    await page.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.workflowsPage.assertEnabled();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    for (const folderId of [ctx.folderA, ctx.folderB, ...ctx.folders]) {
      await seed.purgeFolder(page, folderId).catch(() => {});
    }
    // Anything that ended up back in default has to be swept by id.
    for (const wf of ctx.workflows) {
      await seed.deleteWorkflow(page, wf.id).catch(() => {});
    }
    await seed.deleteDestination(page, ctx.destName).catch(() => {});
    await page.close();
  });

  // Seed a workflow and remember it for teardown.
  const seedWorkflow = async (page, { folderId, draft = false, name, triggerKind }) => {
    const wf = await seed.createWorkflow(page, {
      name: name ?? `wf_auto_fld_${uniq()}`,
      destName: ctx.destName,
      folderId,
      draft,
      triggerKind,
    });
    ctx.workflows.push(wf);
    return wf;
  };

  // Register a folder created inside a test so afterAll sweeps it even when the
  // test fails between creation and its inline deleteFolder.
  const trackFolder = (folderId) => {
    ctx.folders.push(folderId);
  };

  // ===== P0 =====

  test('WFF-UI-01: folder rail renders with the default folder and the list loads inside it', {
    tag: ['@workflowFolders', '@P0'],
  }, async () => {
    await pm.workflowFoldersPage.goToList();
    await expect(pm.workflowFoldersPage.folderTabsContainer).toBeVisible();
    await pm.workflowFoldersPage.expectDefaultFolderExists();
    await expect(pm.workflowFoldersPage.listPage).toBeVisible();
  });

  test('WFF-UI-02: create a folder from the rail, and reject an empty name', {
    tag: ['@workflowFolders', '@P0'],
  }, async ({ page }) => {
    await pm.workflowFoldersPage.goToList();

    // Empty name keeps the dialog open; cancel then closes it.
    await pm.workflowFoldersPage.clickAddFolder();
    await pm.workflowFoldersPage.expectFolderSaveBlockedOnEmptyName();
    await pm.workflowFoldersPage.cancelFolderDialog();

    const name = `wf_auto_fld_ui_${uniq()}`;
    await pm.workflowFoldersPage.createFolder(name, 'created from the UI');
    await pm.workflowFoldersPage.expectFolderTabVisible(name);

    const folderId = await pm.workflowFoldersPage.resolveFolderIdByName(name);
    trackFolder(folderId);
    // The tab is real, not a phantom store entry: clicking it navigates the
    // list into the folder that was just created.
    await pm.workflowFoldersPage.clickFolderTab(name);
    await pm.workflowFoldersPage.expectFolderInUrl(folderId);

    await seed.deleteFolder(page, folderId);
  });

  test('WFF-UI-03: a workflow created in folder B lists in B and not in A', {
    tag: ['@workflowFolders', '@P0'],
  }, async ({ page }) => {
    const wf = await seedWorkflow(page, { folderId: ctx.folderB });

    await pm.workflowFoldersPage.goToList(ctx.folderB);
    await pm.workflowFoldersPage.expectWorkflowVisible(wf.name);

    await pm.workflowFoldersPage.goToList(ctx.folderA);
    await pm.workflowFoldersPage.searchWorkflows(wf.name);
    await pm.workflowFoldersPage.expectWorkflowNotVisible(wf.name);
  });

  test('WFF-UI-05: move a workflow A -> B from the row action', {
    tag: ['@workflowFolders', '@P0'],
  }, async ({ page }) => {
    const wf = await seedWorkflow(page, { folderId: ctx.folderA });

    await pm.workflowFoldersPage.goToList(ctx.folderA);
    await pm.workflowFoldersPage.expectWorkflowVisible(wf.name);
    await pm.workflowFoldersPage.openMoveDialog(wf.name);

    // Destination opens on nothing, and the source is excluded from the list, so Move
    // is disabled until a real destination is picked.
    await pm.workflowFoldersPage.expectMoveDisabled();
    await pm.workflowFoldersPage.selectMoveDestination(FOLDER_B);
    await pm.workflowFoldersPage.expectMoveEnabled();
    await pm.workflowFoldersPage.clickMove();

    await pm.workflowFoldersPage.searchWorkflows(wf.name);
    await pm.workflowFoldersPage.expectWorkflowNotVisible(wf.name);

    await pm.workflowFoldersPage.goToList(ctx.folderB);
    await pm.workflowFoldersPage.expectWorkflowVisible(wf.name);

    const inB = await seed.listWorkflows(page, { folder: ctx.folderB });
    expect(inB.some((row) => row.id === wf.id)).toBe(true);
  });

  test('WFF-UI-06: search scope — "this folder" hides a match in B, "all folders" shows it', {
    tag: ['@workflowFolders', '@P0'],
  }, async ({ page }) => {
    const token = `needle${uniq()}`;
    const inB = await seedWorkflow(page, { folderId: ctx.folderB, name: `wf_auto_fld_${token}` });

    await pm.workflowFoldersPage.goToList(ctx.folderA);
    await pm.workflowFoldersPage.searchWorkflows(token);
    await pm.workflowFoldersPage.expectWorkflowNotVisible(inB.name);

    await pm.workflowFoldersPage.setSearchScopeAllFolders();
    await pm.workflowFoldersPage.searchWorkflows(token);
    await expect(pm.workflowFoldersPage.workflowRowAnchor(inB.name)).toBeVisible({ timeout: 30000 });
  });

  test('WFF-UI-10: a folder holding a workflow cannot be deleted until it is emptied', {
    tag: ['@workflowFolders', '@P0'],
  }, async ({ page }) => {
    const doomed = `wf_auto_fld_del_${uniq()}`;
    const doomedId = await seed.createFolder(page, doomed);
    trackFolder(doomedId);
    const wf = await seedWorkflow(page, { folderId: doomedId });

    await pm.workflowFoldersPage.goToList(doomedId);
    await pm.workflowFoldersPage.expectFolderTabVisible(doomed);
    await pm.workflowFoldersPage.clickDeleteFolder(doomed);
    await pm.workflowFoldersPage.confirmDeleteFolder();

    // The guard is server-side, so the folder must survive the confirm.
    await pm.workflowFoldersPage.goToList();
    await pm.workflowFoldersPage.expectFolderTabVisible(doomed);

    await seed.deleteWorkflow(page, wf.id);
    await pm.workflowFoldersPage.goToList();
    await pm.workflowFoldersPage.clickDeleteFolder(doomed);
    await pm.workflowFoldersPage.confirmDeleteFolder();
    await pm.workflowFoldersPage.goToList();
    await pm.workflowFoldersPage.expectFolderTabNotVisible(doomed);
  });

  test('WFF-UI-10b: the default folder offers no edit or delete', {
    tag: ['@workflowFolders', '@P0'],
  }, async () => {
    await pm.workflowFoldersPage.goToList();
    await pm.workflowFoldersPage.expectMoreIconNotVisible('default');
  });

  test('WFF-UI-11: the folder survives the trip into the editor and back', {
    tag: ['@workflowFolders', '@P0'],
  }, async ({ page }) => {
    // The list is the PARENT route, so a router.push to a child replaces the whole query.
    // Dropping `folder` there resets the list behind the editor and the return trip.
    const wf = await seedWorkflow(page, { folderId: ctx.folderB });

    await pm.workflowFoldersPage.goToList(ctx.folderB);
    await pm.workflowFoldersPage.expectWorkflowVisible(wf.name);
    await pm.workflowFoldersPage.expectFolderInUrl(ctx.folderB);

    await pm.workflowFoldersPage.openEditorFromRow(wf.name);
    // Editing: the create-only picker is gone, and the folder it was opened from is the
    // one the header names — absence alone would also pass on an editor that lost it.
    await pm.workflowFoldersPage.expectEditorFolderPickerHidden();
    await pm.workflowFoldersPage.expectEditorFolderStatic(FOLDER_B);
    await pm.workflowFoldersPage.expectFolderInUrl(ctx.folderB);

    await page.goBack();
    await pm.workflowFoldersPage.waitForListReady();
    await pm.workflowFoldersPage.expectFolderInUrl(ctx.folderB);
    await pm.workflowFoldersPage.expectWorkflowVisible(wf.name);
  });

  test('WFF-UI-12: a workflow outside the default folder survives a cold deep-link reload', {
    tag: ['@workflowFolders', '@P0'],
  }, async ({ page }) => {
    // The editor's cold load used to list only the default folder, so a refresh on a
    // workflow living elsewhere reported "not found".
    const wf = await seedWorkflow(page, { folderId: ctx.folderB });

    await pm.workflowFoldersPage.goToList(ctx.folderB);
    await pm.workflowFoldersPage.expectWorkflowVisible(wf.name);
    await pm.workflowFoldersPage.openEditorFromRow(wf.name);

    await pm.workflowFoldersPage.reloadCurrentUrl();
    await pm.workflowFoldersPage.expectEditorVisible();
    await pm.workflowFoldersPage.expectEditorNameContains(wf.name);
  });

  // ===== P1 =====

  test('WFF-UI-07: switching folders clears a cross-folder search', {
    tag: ['@workflowFolders', '@P1'],
  }, async ({ page }) => {
    const token = `needle${uniq()}`;
    await seedWorkflow(page, { folderId: ctx.folderB, name: `wf_auto_fld_${token}` });

    await pm.workflowFoldersPage.goToList(ctx.folderA);
    await pm.workflowFoldersPage.setSearchScopeAllFolders();
    await pm.workflowFoldersPage.searchWorkflows(token);

    // Driven off the URL, so this covers rail clicks and browser back/forward alike:
    // a cross-folder search must not keep showing org-wide results under a new folder.
    await pm.workflowFoldersPage.clickFolderTab(FOLDER_B);
    await expect(pm.workflowFoldersPage.listSearchInput).toHaveValue('');
    expect(await pm.workflowFoldersPage.isSearchAcrossFoldersActive()).toBe(false);
  });

  test('WFF-UI-08: the trigger-type tab filters inside the active folder', {
    tag: ['@workflowFolders', '@P1'],
  }, async ({ page }) => {
    // Two trigger kinds in one folder, sharing a search token: the token keeps BOTH rows
    // candidates, so the trigger tab is the only thing that can hide either. Without the
    // shared token, expectWorkflowVisible's retry can leave one name in the search box and
    // the "other row is gone" assertion passes on the name filter instead of the tab.
    const token = `trg${uniq()}`;
    const alertWf = await seedWorkflow(page, { folderId: ctx.folderA, name: `wf_auto_fld_${token}_alert` });
    const incidentWf = await seedWorkflow(page, {
      folderId: ctx.folderA,
      name: `wf_auto_fld_${token}_incident`,
      triggerKind: 'incident_event',
    });

    await pm.workflowFoldersPage.goToList(ctx.folderA);
    await pm.workflowFoldersPage.expectWorkflowVisible(alertWf.name);
    await pm.workflowFoldersPage.expectWorkflowVisible(incidentWf.name);

    // Both fetched and both matching the query — the filter is client-side over the rows
    // already in hand, so the tab switch below needs no refetch to be observable.
    await pm.workflowFoldersPage.searchWorkflows(token);
    await expect(pm.workflowFoldersPage.workflowRowAnchor(alertWf.name)).toBeVisible();
    await expect(pm.workflowFoldersPage.workflowRowAnchor(incidentWf.name)).toBeVisible();

    await pm.workflowFoldersPage.selectListTab('alert_fired');
    await pm.workflowFoldersPage.expectListTabActive('alert_fired');
    await expect(pm.workflowFoldersPage.workflowRowAnchor(alertWf.name)).toBeVisible();
    await expect(pm.workflowFoldersPage.workflowRowAnchor(incidentWf.name)).toBeHidden();
    await pm.workflowFoldersPage.expectFolderInUrl(ctx.folderA);
  });

  test('WFF-UI-09: rename a folder, and filter the rail by name', {
    tag: ['@workflowFolders', '@P1'],
  }, async ({ page }) => {
    const original = `wf_auto_fld_ren_${uniq()}`;
    const folderId = await seed.createFolder(page, original);
    trackFolder(folderId);
    const renamed = `${original}_renamed`;

    await pm.workflowFoldersPage.goToList();
    await pm.workflowFoldersPage.expectFolderTabVisible(original);
    await pm.workflowFoldersPage.renameFolder(original, renamed);
    await pm.workflowFoldersPage.goToList();
    await pm.workflowFoldersPage.expectFolderTabVisible(renamed);

    await pm.workflowFoldersPage.searchFolders(renamed);
    await pm.workflowFoldersPage.expectFolderTabVisible(renamed);
    await pm.workflowFoldersPage.searchFolders(`nomatch_${uniq()}`);
    expect(await pm.workflowFoldersPage.folderTabCount()).toBe(0);

    await seed.deleteFolder(page, folderId);
  });

  test('WFF-UI-13: a draft is folder-scoped and cannot be moved', {
    tag: ['@workflowFolders', '@P1'],
  }, async ({ page }) => {
    const draft = await seedWorkflow(page, { folderId: ctx.folderB, draft: true });

    await pm.workflowFoldersPage.goToList(ctx.folderB);
    await pm.workflowFoldersPage.searchWorkflows(draft.name);
    await pm.workflowFoldersPage.expectDraftTagOnRow(draft.name);
    // move_workflows only touches the workflows table, so the list keeps move published-only.
    await pm.workflowFoldersPage.expectMoveUnavailableForDraft(draft.name);

    await pm.workflowFoldersPage.goToList(ctx.folderA);
    await pm.workflowFoldersPage.searchWorkflows(draft.name);
    await pm.workflowFoldersPage.expectWorkflowNotVisible(draft.name);
  });

  // ===== P2 =====

  test('WFF-UI-04: the editor header picks the folder a new workflow is created in', {
    tag: ['@workflowFolders', '@P2'],
  }, async () => {
    await pm.workflowsPage.goToAddEmpty();
    // The picker renders only on create; on an existing workflow the folder is static text.
    await pm.workflowFoldersPage.expectEditorFolderPickerVisible();
    await pm.workflowFoldersPage.selectFolderInEditor(FOLDER_B);
    await expect(pm.workflowFoldersPage.editorFolderDropdown).toContainText(FOLDER_B, {
      timeout: 10000,
    });
  });
});
