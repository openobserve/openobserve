const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { generateDashboardName } from "./utils/configPanelHelpers.js";
const testLogger = require("../utils/test-logger.js");
const {
  PANEL_A,
  PANEL_B,
  createLayoutDashboard,
  getSavedLayouts,
  deleteLayoutDashboard,
  trackDashboardPuts,
} = require("./utils/layoutEditFixtures.js");

// GridStack drops a gs-* attribute whose value is 0, so a missing one reads as 0.
const toBox = ({ x, y, w, h }) => ({
  x: Number(x ?? 0),
  y: Number(y ?? 0),
  w: Number(w ?? 0),
  h: Number(h ?? 0),
});

test.describe("Dashboard layout edit mode testcases", () => {
  test.describe.configure({ mode: "parallel" });

  let pm;
  let dashboardId;
  let panelIds;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    ({ dashboardId, panelIds } = await createLayoutDashboard(generateDashboardName()));
    await pm.dashboardPanelActions.openDashboardById(dashboardId);
    await pm.dashboardZoomDrag.waitForPanelTile(panelIds[0]);
    await pm.dashboardZoomDrag.waitForPanelTile(panelIds[1]);
    testLogger.info("Layout dashboard opened", { dashboardId, panelIds });
  });

  test.afterEach(async () => {
    await deleteLayoutDashboard(dashboardId);
  });

  const onScreenBox = async (panelId) => toBox(await pm.dashboardZoomDrag.readPanelLayout(panelId));

  test("TC-LE-001: Dashboard opens with the layout locked", {
    tag: ["@dashboard-layout-edit", "@all", "@smoke", "@P0"],
  }, async () => {
    const actions = pm.dashboardPanelActions;

    await expect(actions.layoutEditBtn).toBeVisible();
    await expect(actions.layoutEditBadge).toHaveCount(0);
    await expect(actions.layoutEditSaveBtn).toHaveCount(0);
    await expect(actions.panelDragGrip).toHaveCount(0);
    await expect(actions.lockedGrid).toHaveCount(1);

    await actions.openPanelMenu(PANEL_A.title);
    await expect(actions.panelMenuEditPanel).toBeVisible();
    await expect(actions.panelMenuEditLayout).toHaveCount(0);
    await actions.closePanelMenu();

    testLogger.info("View mode keeps the layout locked");
  });

  test("TC-LE-002: A clean edit session hides saving actions and exits without a prompt", {
    tag: ["@dashboard-layout-edit", "@all", "@smoke", "@P0"],
  }, async () => {
    const actions = pm.dashboardPanelActions;

    await expect(actions.addTabBtn).toBeVisible();
    await expect(actions.getTabRenameBtn("default")).toHaveCount(1);

    await actions.enterLayoutEdit();

    await expect(actions.layoutEditBadge).toBeVisible();
    await expect(actions.layoutEditChangesCount).toHaveText("No changes");
    await expect(actions.layoutEditSaveBtn).toBeDisabled();
    await expect(actions.layoutEditUndoBtn).toBeDisabled();
    await expect(actions.layoutEditRedoBtn).toBeDisabled();
    await expect(actions.editingGrid).toHaveCount(1);
    await expect(actions.lockedGrid).toHaveCount(0);
    await expect(actions.panelDragGrip).toHaveCount(2);

    await expect(actions.layoutEditBtn).toHaveCount(0);
    await expect(actions.addPanelBtn).toHaveCount(0);
    await expect(actions.shareBtn).toHaveCount(0);
    await expect(actions.settingsBtn).toHaveCount(0);
    await expect(actions.addTabBtn).toHaveCount(0);
    await expect(actions.getTabRenameBtn("default")).toHaveCount(0);

    await actions.openPanelMenu(PANEL_A.title);
    await expect(actions.panelMenuEditLayout).toBeVisible();
    await expect(actions.panelMenuEditPanel).toHaveCount(0);
    await expect(actions.panelMenuDuplicate).toHaveCount(0);
    await expect(actions.panelMenuDelete).toHaveCount(0);
    await actions.closePanelMenu();

    await actions.requestLayoutDiscard();
    await expect(actions.layoutDiscardDialog).toHaveCount(0);
    await expect(actions.layoutEditBtn).toBeVisible();
    await expect(actions.layoutEditBadge).toHaveCount(0);
    await expect(actions.editingGrid).toHaveCount(0);
    await expect(actions.panelDragGrip).toHaveCount(0);

    testLogger.info("Clean edit session exited without a discard prompt");
  });

  test("TC-LE-003: A panel drag stays a draft until Save persists it", {
    tag: ["@dashboard-layout-edit", "@all", "@functional", "@P1"],
  }, async ({ page }) => {
    const actions = pm.dashboardPanelActions;
    const puts = trackDashboardPuts(page);
    const before = await onScreenBox(panelIds[1]);

    await actions.enterLayoutEdit();
    await pm.dashboardZoomDrag.dragPanelHeader(panelIds[1], { deltaX: -400, deltaY: 200 });

    await expect.poll(async () => JSON.stringify(await onScreenBox(panelIds[1]))).not.toBe(JSON.stringify(before));
    await expect(actions.layoutEditChangesCount).toHaveText("1 change");
    await expect(actions.layoutEditSaveBtn).toBeEnabled();
    expect(puts.count).toBe(0);

    const draftA = await onScreenBox(panelIds[0]);
    const draftB = await onScreenBox(panelIds[1]);
    const putResponse = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`/dashboards/${dashboardId}`),
      { timeout: 30000 }
    );
    await actions.saveLayoutEdit();
    expect((await putResponse).ok()).toBe(true);
    expect(puts.count).toBe(1);
    await expect(actions.layoutEditBtn).toBeVisible();

    const saved = await getSavedLayouts(dashboardId);
    expect(saved[panelIds[0]]).toEqual(draftA);
    expect(saved[panelIds[1]]).toEqual(draftB);

    await page.reload();
    await pm.dashboardZoomDrag.waitForPanelTile(panelIds[1]);
    await expect.poll(() => onScreenBox(panelIds[1])).toEqual(draftB);
    await expect(actions.lockedGrid).toHaveCount(1);

    testLogger.info("Dragged layout persisted only on Save", { before, draftB });
  });

  test("TC-LE-004: Layout dialog Apply adds draft steps that Undo and Redo walk", {
    tag: ["@dashboard-layout-edit", "@all", "@functional", "@P1"],
  }, async ({ page }) => {
    const actions = pm.dashboardPanelActions;
    const puts = trackDashboardPuts(page);
    const heightOf = async (panelId) => (await onScreenBox(panelId)).h;

    await actions.enterLayoutEdit();

    await actions.applyPanelHeight(PANEL_A.title, 14);
    await expect(actions.layoutEditChangesCount).toHaveText("1 change");
    await expect.poll(() => heightOf(panelIds[0])).toBe(14);

    await actions.applyPanelHeight(PANEL_B.title, 12);
    await expect(actions.layoutEditChangesCount).toHaveText("2 changes");
    await expect.poll(() => heightOf(panelIds[1])).toBe(12);
    await expect(actions.layoutEditRedoBtn).toBeDisabled();

    await actions.undoLayoutEdit();
    await expect(actions.layoutEditChangesCount).toHaveText("1 change");
    await expect.poll(() => heightOf(panelIds[1])).toBe(PANEL_B.layout.h);
    await expect(actions.layoutEditRedoBtn).toBeEnabled();

    await actions.undoLayoutEdit();
    await expect(actions.layoutEditChangesCount).toHaveText("No changes");
    await expect.poll(() => heightOf(panelIds[0])).toBe(PANEL_A.layout.h);
    await expect(actions.layoutEditUndoBtn).toBeDisabled();
    await expect(actions.layoutEditSaveBtn).toBeDisabled();

    await actions.redoLayoutEdit();
    await expect(actions.layoutEditChangesCount).toHaveText("1 change");
    await expect.poll(() => heightOf(panelIds[0])).toBe(14);
    await expect(actions.layoutEditSaveBtn).toBeEnabled();

    expect(puts.count).toBe(0);
    await actions.discardLayoutEdit();

    testLogger.info("Undo/Redo walked the layout draft history");
  });

  test("TC-LE-005: Discard asks first and restores the last saved layout", {
    tag: ["@dashboard-layout-edit", "@all", "@functional", "@P1"],
  }, async ({ page }) => {
    const actions = pm.dashboardPanelActions;
    const puts = trackDashboardPuts(page);
    const savedBefore = await getSavedLayouts(dashboardId);

    await actions.enterLayoutEdit();
    await actions.applyPanelHeight(PANEL_A.title, 14);
    await expect(actions.layoutEditChangesCount).toHaveText("1 change");

    await actions.requestLayoutDiscard();
    await expect(actions.layoutDiscardDialog).toBeVisible();
    await expect(actions.layoutDiscardDialog).toContainText("1 unsaved layout change");
    await actions.cancelLayoutDiscard();
    await expect(actions.layoutEditChangesCount).toHaveText("1 change");
    await expect.poll(async () => (await onScreenBox(panelIds[0])).h).toBe(14);

    await actions.requestLayoutDiscard();
    await actions.confirmLayoutDiscard();
    await expect(actions.layoutEditBtn).toBeVisible();
    await expect(actions.layoutEditBadge).toHaveCount(0);
    await expect.poll(async () => (await onScreenBox(panelIds[0])).h).toBe(PANEL_A.layout.h);

    expect(puts.count).toBe(0);
    expect(await getSavedLayouts(dashboardId)).toEqual(savedBefore);

    testLogger.info("Discard restored the saved layout without a PUT");
  });

  test("TC-LE-006: Leaving with unsaved changes asks to stay or discard", {
    tag: ["@dashboard-layout-edit", "@all", "@functional", "@P1"],
  }, async ({ page }) => {
    const actions = pm.dashboardPanelActions;
    const puts = trackDashboardPuts(page);
    const savedBefore = await getSavedLayouts(dashboardId);

    await actions.enterLayoutEdit();
    await actions.applyPanelHeight(PANEL_A.title, 14);
    await expect(actions.layoutEditChangesCount).toHaveText("1 change");

    await actions.clickDashboardBack();
    await expect(actions.layoutDiscardDialog).toBeVisible();
    await expect(actions.layoutDiscardCancelBtn).toHaveText("Stay");
    await actions.cancelLayoutDiscard();
    await expect(page).toHaveURL(/\/dashboards\/view/);
    await expect(actions.layoutEditChangesCount).toHaveText("1 change");

    await actions.clickDashboardBack();
    await expect(actions.layoutDiscardConfirmBtn).toHaveText("Discard and leave");
    await actions.confirmLayoutDiscard();
    await expect(page).not.toHaveURL(/\/dashboards\/view/);

    expect(puts.count).toBe(0);
    expect(await getSavedLayouts(dashboardId)).toEqual(savedBefore);

    testLogger.info("Leave guard offered Stay, then discarded on leave");
  });

  test("TC-LE-007: Keyboard shortcuts undo, redo, exit and save the layout draft", {
    tag: ["@dashboard-layout-edit", "@all", "@functional", "@P2"],
  }, async ({ page }) => {
    const actions = pm.dashboardPanelActions;

    await actions.enterLayoutEdit();
    await actions.applyPanelHeight(PANEL_A.title, 14);
    await expect(actions.layoutEditChangesCount).toHaveText("1 change");

    await actions.pressLayoutShortcut("ControlOrMeta+z");
    await expect(actions.layoutEditChangesCount).toHaveText("No changes");

    await actions.pressLayoutShortcut("ControlOrMeta+Shift+z");
    await expect(actions.layoutEditChangesCount).toHaveText("1 change");

    await actions.pressLayoutShortcut("Escape");
    await expect(actions.layoutDiscardDialog).toBeVisible();
    await actions.cancelLayoutDiscard();
    await expect(actions.layoutEditChangesCount).toHaveText("1 change");

    const putResponse = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes(`/dashboards/${dashboardId}`),
      { timeout: 30000 }
    );
    await actions.pressLayoutShortcut("ControlOrMeta+s");
    expect((await putResponse).ok()).toBe(true);
    await expect(actions.layoutEditBtn).toBeVisible();
    expect((await getSavedLayouts(dashboardId))[panelIds[0]].h).toBe(14);

    testLogger.info("Keyboard shortcuts drove the layout draft and saved it");
  });
});
