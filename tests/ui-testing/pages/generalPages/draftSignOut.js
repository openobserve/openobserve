// Unsaved drafts in this browser (e.g. a panel built, never saved, then left by page.goto) hold Sign Out on a confirm dialog.
export async function confirmDraftSignOut(page, timeout = 5000) {
  const confirm = page.locator('[data-test="editor-draft-signout-confirm"]');
  // With no drafts the app goes straight to /login, which ends the wait at once.
  await Promise.race([
    confirm.waitFor({ state: 'visible', timeout }),
    page.waitForURL(/\/login/, { timeout }),
  ]).catch(() => {});
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
  }
}
