// Copyright 2026 OpenObserve Inc.

export const PANEL_LEAVE_DIALOG = '[data-test="dashboard-panel-leave-dialog"]';
const DISCARD_CHANGES_BTN = `${PANEL_LEAVE_DIALOG} [data-test="o-dialog-secondary-btn"]`;
const KEEP_AS_DRAFT_BTN = `${PANEL_LEAVE_DIALOG} [data-test="o-dialog-primary-btn"]`;

const leftEditor = (url) => !url.pathname.includes("add_panel");

/**
 * After clicking the panel editor's Discard button, finish leaving the editor.
 * An edited panel opens the in-app "Leave panel editor?" dialog instead of a
 * native confirm; an untouched panel navigates straight away. Picks the
 * dialog's "Discard changes" by default so no browser draft is left behind.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{choice?: "discard" | "keep", timeout?: number}} options
 * @returns {Promise<boolean>} whether the dialog was shown
 */
export async function settlePanelLeave(page, { choice = "discard", timeout = 30000 } = {}) {
  const button = page.locator(choice === "keep" ? KEEP_AS_DRAFT_BTN : DISCARD_CHANGES_BTN);
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
