// Copyright 2026 OpenObserve Inc.

export const PANEL_LEAVE_DIALOG = '[data-test="dashboard-panel-leave-dialog"]';
export const PANEL_DRAFT_RESTORE_DIALOG = '[data-test="dashboard-panel-draft-restore-dialog"]';

const LEAVE_BUTTONS = {
  save: '[data-test="dashboard-panel-leave-save"]',
  keep: `${PANEL_LEAVE_DIALOG} [data-test="o-dialog-secondary-btn"]`,
  discard: `${PANEL_LEAVE_DIALOG} [data-test="o-dialog-neutral-btn"]`,
};

const RESTORE_BUTTONS = {
  continue: '[data-test="dashboard-panel-draft-continue"]',
  fresh: `${PANEL_DRAFT_RESTORE_DIALOG} [data-test="o-dialog-secondary-btn"]`,
};

const leftEditor = (url) => !url.pathname.includes("add_panel");

/**
 * After clicking the panel editor's Discard or Back, finish leaving the editor.
 * A panel with unsaved edits opens the in-app "Leave with unsaved changes?"
 * dialog (Save / Keep draft / Discard); an untouched panel navigates straight
 * away. Picks Discard by default so no browser draft is left behind.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{choice?: "discard" | "keep" | "save", timeout?: number}} options
 * @returns {Promise<boolean>} whether the dialog was shown
 */
export async function settlePanelLeave(page, { choice = "discard", timeout = 30000 } = {}) {
  const button = page.locator(LEAVE_BUTTONS[choice]);
  const left = page.waitForURL(leftEditor, { timeout }).then(() => "left");
  const dialog = button.waitFor({ state: "visible", timeout }).then(() => "dialog");
  left.catch(() => {});
  dialog.catch(() => {});
  const first = await Promise.race([left, dialog]).catch(() => null);
  if (first !== "dialog") return false;
  await button.click();
  await page.waitForURL(leftEditor, { timeout });
  return true;
}

/**
 * Answer the leave dialog only if it is already up, without waiting for a navigation.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{choice?: "discard" | "keep" | "save", timeout?: number}} options
 * @returns {Promise<boolean>} whether the dialog was answered
 */
export async function answerPanelLeaveIfShown(page, { choice = "discard", timeout = 2000 } = {}) {
  const button = page.locator(LEAVE_BUTTONS[choice]);
  const shown = await button
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
  if (shown) await button.click();
  return shown;
}

/**
 * The editor asks "Unsaved panel draft" when this browser holds a draft for the
 * panel (or the dashboard's new panel). Answer it so the editor finishes opening.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{choice?: "continue" | "fresh", timeout?: number}} options
 * @returns {Promise<boolean>} whether the dialog was shown
 */
export async function answerPanelDraftRestore(page, { choice = "fresh", timeout = 5000 } = {}) {
  const button = page.locator(RESTORE_BUTTONS[choice]);
  const shown = await button
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
  if (!shown) return false;
  await button.click();
  await page.locator(PANEL_DRAFT_RESTORE_DIALOG).waitFor({ state: "hidden", timeout });
  return true;
}
