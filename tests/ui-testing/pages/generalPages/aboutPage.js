// aboutPage.js
import { expect } from '@playwright/test';


export class AboutPage {
    constructor(page) {
        this.page = page;
        this.helpPageMenu = page.locator('[data-test="menu-link-help-item"]');
        this.aboutPageMenu = page.locator('[data-test="menu-link-about-item"]');
        // this.aboutPageMenu = page.locator('[data-test="menu-link-about-item"]');
        // Config-endpoint split (config-bootstrap): the meta-bar pills are the
        // visible canary that the authenticated full config loaded. The About
        // view renders them without dedicated data-test hooks, so locate them
        // by their stable text/role contracts instead.
        this.navRail = page.locator('[data-test="navbar-main-nav"]');
        this.versionPill = page.getByText(/v\d+\.\d+\.\d+/);
        this.buildTypePill = page.getByText(/^\s*(opensource|enterprise)\s*$/);
        this.commitHashPill = page.getByText(/^[0-9a-f]{40}$/);
        this.commitCopyButton = page.getByRole('button', { name: 'Copy commit hash' });
        this.successToast = page.locator('[data-test-variant="success"]');

    }
    async clickHelpMenu() {
        await this.helpPageMenu.click();
    }
    async gotoAboutPage() {
        await this.aboutPageMenu.click();

    }


    async aboutPageDefaultOrg() {

        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByText('default', { exact: true }).first().click();


    }

    async aboutPageDefaultMultiOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
    }

    async aboutPageURLValidation() {
        // TODO: Fix this test
        // await expect(this.page).not.toHaveURL(/default/);
    }

    async aboutURLValidation() {
        await expect(this.page).toHaveURL(/about/);
    }

    async selectOrganization(orgName) {
        const dropdown = this.page.locator('[data-test="navbar-organizations-select"]');
        await dropdown.getByText('arrow_drop_down').click();

        try {
            if (orgName === 'default') {
                await this.page.getByText('default', { exact: true }).first().click();
            } else {
                await this.page.getByRole('option', { name: orgName }).locator('div').nth(2).click();
            }
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        } catch (error) {
            throw new Error(`Failed to select organization: ${orgName}`);
        }
    }

    // ── Config-endpoint split (config-bootstrap) helpers ────────────────────
    // Navigate straight to the About page for the given org. Used by the config
    // specs instead of driving the Help menu, so the navigation is deterministic
    // and the version pill can be polled after the async full-config fetch.
    async gotoAboutPageByUrl(orgIdentifier) {
        await this.page.goto(
            `${process.env["ZO_BASE_URL"]}/web/about?org_identifier=${orgIdentifier}`,
            { waitUntil: 'domcontentloaded', timeout: 60000 },
        );
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    // The left nav rail only renders once the authenticated full config resolves
    // (MainLayout sets menuReady=true in getConfig success/fail-open). It is the
    // positive signal that the full config — not just the bootstrap — has loaded.
    async expectNavRailVisible(timeout = 15000) {
        await expect(this.navRail).toBeVisible({ timeout });
    }

    // Poll the version pill until it holds a non-empty string. `version` exists
    // ONLY on the full config, so a non-empty pill proves the full config loaded
    // and the smaller bootstrap subset did not clobber it.
    async waitForVersionNonEmpty(timeout = 30000) {
        await expect(this.versionPill).toBeVisible({ timeout });
        await expect(this.versionPill).not.toHaveText(/^\s*$/, { timeout });
    }

    async expectBuildType(expected) {
        await expect(this.buildTypePill).toBeVisible({ timeout: 15000 });
        await expect(this.buildTypePill).toHaveText(expected);
    }

    async getVersionText() {
        return (await this.versionPill.innerText()).trim();
    }

    async waitForCommitHashNonEmpty(timeout = 30000) {
        await expect(this.commitHashPill).toBeVisible({ timeout });
        await expect(this.commitHashPill).not.toHaveText(/^\s*$/, { timeout });
    }

    async copyCommitHash() {
        await expect(this.commitCopyButton).toBeVisible({ timeout: 15000 });
        await this.commitCopyButton.click();
    }

    // The copy-to-clipboard success toast (variant="success") is the durable
    // signal that copyToClipboard ran; the toast itself auto-dismisses.
    async expectCopySuccessToast() {
        await expect(this.successToast.first()).toBeVisible({ timeout: 15000 });
    }


}
