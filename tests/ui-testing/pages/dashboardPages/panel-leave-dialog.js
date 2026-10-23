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

export const PANEL_DRAFT_CHANGED_ON_SERVER =
  '[data-test="dashboard-panel-draft-changed-on-server"]';
export const ADD_PANEL_DRAFT_DOT = '[data-test="dashboard-panel-add-draft-dot"]';
export const PANEL_DRAFT_DOT = '[data-test="dashboard-panel-draft-dot"]';
export const EDIT_PANEL_DRAFT_DOT = '[data-test="dashboard-panel-edit-draft-dot"]';

const PANEL_DRAFT_PREFIX = "o2_panel_draft:";
const EDITOR_SAVE_BTN = '[data-test="dashboard-panel-save"]';

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
  // Browser Back changes the URL before the guard opens the dialog, so only an unmounted editor counts as left.
  const left = page
    .waitForURL(leftEditor, { timeout })
    .then(() => page.locator(EDITOR_SAVE_BTN).first().waitFor({ state: "detached", timeout }))
    .then(() => "left");
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

/**
 * Press Escape on the leave dialog, which keeps the user in the editor.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function dismissPanelLeave(page, { timeout = 15000 } = {}) {
  const dialog = page.locator(PANEL_LEAVE_DIALOG);
  await dialog.waitFor({ state: "visible", timeout });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout });
}

/**
 * Press Escape on the restore dialog: the editor opens fresh but the stored draft is kept.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function dismissPanelDraftRestore(page, { timeout = 15000 } = {}) {
  const dialog = page.locator(PANEL_DRAFT_RESTORE_DIALOG);
  await dialog.waitFor({ state: "visible", timeout });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout });
}

/** @param {import('@playwright/test').Page} page */
export function getPanelDraftDot(page) {
  return page.locator(PANEL_DRAFT_DOT);
}

/** @param {import('@playwright/test').Page} page */
export function getEditPanelDraftDot(page) {
  return page.locator(EDIT_PANEL_DRAFT_DOT);
}

/** @param {import('@playwright/test').Page} page */
export function getAddPanelDraftDot(page) {
  return page.locator(ADD_PANEL_DRAFT_DOT);
}

/** @param {import('@playwright/test').Page} page */
export function getPanelDraftRestoreDialog(page) {
  return page.locator(PANEL_DRAFT_RESTORE_DIALOG);
}

/** @param {import('@playwright/test').Page} page */
export function getPanelDraftChangedOnServerBanner(page) {
  return page.locator(PANEL_DRAFT_CHANGED_ON_SERVER);
}

/** @param {import('@playwright/test').Page} page */
export function getPanelLeaveDialog(page) {
  return page.locator(PANEL_LEAVE_DIALOG);
}

/**
 * Number of panel drafts this browser holds in localStorage.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
export async function countStoredPanelDrafts(page) {
  return page.evaluate(
    (prefix) => Object.keys(window.localStorage).filter((k) => k.startsWith(prefix)).length,
    PANEL_DRAFT_PREFIX
  );
}

/**
 * Stand in for a teammate's save: alter the stored drafts' snapshot of the server
 * panel so the editor sees the server copy as changed since the draft was made.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>} how many drafts were altered
 */
export async function markStoredDraftsAsStale(page) {
  return page.evaluate((prefix) => {
    let changed = 0;
    for (const key of Object.keys(window.localStorage)) {
      if (!key.startsWith(prefix)) continue;
      const draft = JSON.parse(window.localStorage.getItem(key));
      if (!draft?.basePanel) continue;
      draft.basePanel.description = `changed elsewhere ${Date.now()}`;
      window.localStorage.setItem(key, JSON.stringify(draft));
      changed++;
    }
    return changed;
  }, PANEL_DRAFT_PREFIX);
}
