/** Discards through the editor-draft leave dialog when Back/Cancel opens it, so no draft pops the restore dialog later. */
export async function discardEditorDraftIfAsked(page) {
    const dialog = page.locator('[data-test="editor-draft-leave-dialog"]');
    const asked = await dialog
        .waitFor({ state: 'visible', timeout: 2000 })
        .then(() => true)
        .catch(() => false);
    if (!asked) return;
    await dialog.locator('[data-test="o-dialog-neutral-btn"]').click();
    await dialog.waitFor({ state: 'hidden', timeout: 10000 });
}

/** A draft an earlier test left (e.g. by page.goto) would open the restore dialog over the next editor; call before opening it. */
export async function clearEditorDrafts(page) {
    await page.evaluate(() => {
        Object.keys(localStorage)
            .filter((key) => key.startsWith('o2_draft:') || key === 'o2_draft_index')
            .forEach((key) => localStorage.removeItem(key));
    });
}
