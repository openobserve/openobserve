const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  seedMinimalStream,
  createSloViaApi,
  countDefinition,
  deleteSlosByPrefix,
  deleteFixturesByPrefix,
  createSloFolder,
  deleteSloFolder,
  deleteSloFoldersByPrefix,
  listSlosByName,
  sloDefinitionOf,
  uniqueName,
} = require('../utils/slo-seed.js');

const PREFIX = 'e2e_slo_import';
const ORG = process.env['ORGNAME'];

test.describe.configure({ mode: 'parallel' });

test.describe('SLO import', { tag: ['@slo', '@sloImport', '@all'] }, () => {
  let pm;
  let stream;
  // afterAll runs per worker, so each worker may only sweep its own names.
  let wp;

  test.beforeAll(async ({ browser }, testInfo) => {
    wp = `${PREFIX}_w${testInfo.workerIndex}`;
    const context = await browser.newContext();
    const page = await context.newPage();
    stream = uniqueName(`${wp}_stream`);
    await seedMinimalStream(page, stream);
    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await deleteSlosByPrefix(page, `${wp}_`);
    await deleteSloFoldersByPrefix(page, `${wp}_`);
    await deleteFixturesByPrefix(page, `${wp}_`);
    await context.close();
  });

  test('an exported SLO imports into another folder with its definition intact', {
    tag: ['@P0', '@smoke'],
  }, async ({ page }) => {
    const name = uniqueName(wp);
    const folderName = uniqueName(`${wp}_target`);
    const targetFolder = await createSloFolder(page, folderName);
    const original = await createSloViaApi(page, {
      ...countDefinition({ name, stream, goodExpr: 'status_code < 400', target: 97.5 }),
      description: 'e2e import round trip',
      group_by: ['service'],
      groups_estimate: 3,
      enabled: false,
    });

    await pm.sloListPage.gotoFolder(ORG, 'default');
    await pm.sloListPage.filterTo(name);
    const exported = await pm.sloListPage.exportRowAsJson(name);
    expect(exported.json.name).toBe(name);
    expect(exported.json.groups_estimate, 'export must keep groups_estimate').toBe(3);

    await pm.sloListPage.clickImport();
    await pm.sloImportPage.expectLoaded();
    await pm.sloImportPage.expectFolderSelected('default');
    await pm.sloImportPage.selectFolder(targetFolder, folderName);
    await pm.sloImportPage.uploadJsonFile(exported.fileName, exported.text, name);
    await pm.sloImportPage.importAndExpectList(targetFolder);
    await pm.sloListPage.expectRowVisible(name);

    const all = await listSlosByName(page, name);
    expect(all, 'the original plus exactly one imported copy').toHaveLength(2);
    const source = all.find((slo) => slo.id === original.id);
    const imported = all.find((slo) => slo.id !== original.id);
    expect(source.folder_id).toBe('default');
    expect(imported.folder_id).toBe(targetFolder);
    expect(sloDefinitionOf(imported)).toEqual(sloDefinitionOf(source));
    expect(imported.target).toBe(97.5);
    expect(imported.groups_estimate).toBe(3);
    expect(imported.config.source.query.good_expr).toBe('status_code < 400');
  });

  test('a pasted array creates both SLOs in the folder the list was showing', {
    tag: ['@P0'],
  }, async ({ page }) => {
    const folderName = uniqueName(`${wp}_list`);
    const folder = await createSloFolder(page, folderName);
    const first = uniqueName(`${wp}_a`);
    const second = uniqueName(`${wp}_b`);
    const payload = [
      { ...countDefinition({ name: first, stream }), enabled: false },
      { ...countDefinition({ name: second, stream, target: 95 }), enabled: false },
    ];

    await pm.sloListPage.gotoFolder(ORG, folder);
    await pm.sloListPage.clickImport();
    await pm.sloImportPage.expectLoaded();
    await pm.sloImportPage.expectFolderSelected(folder);
    await pm.sloImportPage.pasteJson(JSON.stringify(payload, null, 2));
    await pm.sloImportPage.importAndExpectList(folder);
    await pm.sloListPage.expectRowVisible(first);
    await pm.sloListPage.expectRowVisible(second);

    for (const [name, target] of [[first, 99], [second, 95]]) {
      const found = await listSlosByName(page, name);
      expect(found, `${name} should exist exactly once`).toHaveLength(1);
      expect(found[0].folder_id).toBe(folder);
      expect(found[0].target).toBe(target);
    }
  });

  test('a duplicate name shows the server reason and creates nothing', {
    tag: ['@P1'],
  }, async ({ page }) => {
    const name = uniqueName(wp);
    const existing = await createSloViaApi(page, { ...countDefinition({ name, stream }), enabled: false });

    await pm.sloImportPage.goto(ORG, 'default');
    await pm.sloImportPage.expectFolderSelected('default');
    await pm.sloImportPage.pasteJson(JSON.stringify({ ...countDefinition({ name, stream }), target: 90 }));
    await pm.sloImportPage.importAndWaitForResults(1);
    await pm.sloImportPage.expectResultText(0, `"${name}" was not imported`);
    await pm.sloImportPage.expectResultText(0, `an SLO named "${name}" already exists in this folder`);
    await pm.sloImportPage.expectStillOnImport();

    const found = await listSlosByName(page, name);
    expect(found, 'no second SLO may be created').toHaveLength(1);
    expect(found[0].id).toBe(existing.id);
    expect(found[0].target).toBe(99);
  });

  test('a target folder deleted before import shows the server reason and creates nothing', {
    tag: ['@P1'],
  }, async ({ page }) => {
    const folderName = uniqueName(`${wp}_gone`);
    const folder = await createSloFolder(page, folderName);
    const name = uniqueName(wp);

    await pm.sloImportPage.goto(ORG, folder);
    await pm.sloImportPage.expectFolderSelected(folder);
    await deleteSloFolder(page, folder);
    await pm.sloImportPage.pasteJson(JSON.stringify(countDefinition({ name, stream })));
    await pm.sloImportPage.importAndWaitForResults(1);
    await pm.sloImportPage.expectResultText(0, `"${name}" was not imported`);
    await pm.sloImportPage.expectResultText(0, `folder "${folder}" not found`);
    await pm.sloImportPage.expectStillOnImport();

    expect(await listSlosByName(page, name), 'nothing may be created in any folder').toHaveLength(0);
  });

  test('broken JSON shows a parse error and creates nothing', {
    tag: ['@P1'],
  }, async ({ page }) => {
    const name = uniqueName(wp);
    const broken = JSON.stringify(countDefinition({ name, stream })).slice(0, -1);

    await pm.sloImportPage.goto(ORG, 'default');
    await pm.sloImportPage.pasteJson(broken);
    await pm.sloImportPage.clickImport();
    await pm.sloImportPage.expectErrorToast('The SLO JSON could not be parsed.');
    await pm.sloImportPage.expectNoResults();
    await pm.sloImportPage.expectStillOnImport();

    expect(await listSlosByName(page, name), 'nothing may be created').toHaveLength(0);
  });
});
