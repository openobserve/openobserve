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
