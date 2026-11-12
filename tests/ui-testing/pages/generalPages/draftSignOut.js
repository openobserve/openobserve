// Sign Out stops on the drafts count dialog, or, when an editor with unsaved changes is open, on that editor's leave dialog instead.
export async function confirmDraftSignOut(page, timeout = 5000) {
  const confirm = page.locator('[data-test="editor-draft-signout-confirm"]');
  const discard = page
    .locator('[data-test="editor-draft-leave-dialog"], [data-test="dashboard-panel-leave-dialog"]')
    .locator('[data-test="o-dialog-neutral-btn"]')
    .first();
  // With no drafts and no dirty editor the app goes straight to /login, which ends the wait at once.
  await Promise.race([
    confirm.waitFor({ state: 'visible', timeout }),
    discard.waitFor({ state: 'visible', timeout }),
    page.waitForURL(/\/login/, { timeout }),
  ]).catch(() => {});
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
  } else if (await discard.isVisible().catch(() => false)) {
    await discard.click();
  }
  await page.waitForURL(/\/login/, { timeout }).catch(() => {});
}
