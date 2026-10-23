import { expect } from "playwright/test";
import {
  countStoredPanelDrafts,
  settlePanelLeave,
} from "../../../pages/dashboardPages/panel-leave-dialog.js";
import { addSimplePanel, setupTestDashboard, waitForPanelEditorSettled } from "./dashCreation.js";

const DRAFT_EDIT_FIELD = "kubernetes_namespace_name";

/** True while the URL is the panel editor. */
export const isInPanelEditor = (url) => url.pathname.includes("add_panel");

/** A dashboard name that parallel workers cannot collide on. */
export const uniqueDashboardName = (prefix) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/** Create a dashboard holding one saved line panel, ending on the dashboard view; returns its name. */
export async function createDashboardWithPanel(page, pm, panelName) {
  const name = uniqueDashboardName("Dashboard_Drafts");
  await setupTestDashboard(page, pm, name);
  await addSimplePanel(pm, panelName);
  await expect(pm.dashboardPanelActions.getEditPanelDropdown(panelName)).toBeVisible({
    timeout: 30000,
  });
  return name;
}

/** Open a saved panel's editor without answering a restore dialog, so the caller can. */
export async function openSavedPanelEditor(page, pm, panelName) {
  await pm.dashboardPanelEdit.editPanel(panelName);
  await page.waitForURL(isInPanelEditor, { timeout: 30000 });
}

/** Open a saved panel, add a breakdown field, and wait for autosave to store the draft. */
export async function editSavedPanel(page, pm, panelName) {
  await openSavedPanelEditor(page, pm, panelName);
  await waitForPanelEditorSettled(page, pm);
  await pm.chartTypeSelector.searchAndAddField(DRAFT_EDIT_FIELD, "b");
  await expect.poll(() => countStoredPanelDrafts(page), { timeout: 15000 }).toBe(1);
}

/** Click Discard and finish leaving with the given leave-dialog choice, which must be asked. */
export async function leaveEditor(page, pm, choice) {
  await pm.dashboardPanelActions.getPanelDiscardBtn().click();
  const asked = await settlePanelLeave(page, { choice });
  expect(asked, "leaving with edits opens the in-app leave dialog").toBe(true);
}
