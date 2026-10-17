// Instance workspace screens: Organizations card in _meta (SlackOrgAccess.vue), the managed card and channel defaults in a served org, the not-included banner (SlackConnectEmpty.vue).
const { expect } = require('@playwright/test');
const { SlackSettingsPage } = require('./slackSettingsPage.js');

const META_ORG = '_meta';

class SlackOrgAccessPage {
  constructor(page) {
    this.page = page;
    this.settings = new SlackSettingsPage(page);
    this.root = page.locator('[data-test="slack-org-access"]');
    this.mode = page.locator('[data-test="slack-org-access-mode"]');
    this.modeAll = page.locator('[data-test="slack-org-access-mode-all"]');
    this.modeSelected = page.locator('[data-test="slack-org-access-mode-listed"]');
    this.onlyMeta = page.locator('[data-test="slack-org-access-only-meta"]');
    this.picker = page.locator('[data-test="slack-org-access-picker"]');
    this.pickerTrigger = page.locator('[data-test="slack-org-access-picker-trigger"]');
    this.pickerSearch = page.locator('[data-test="slack-org-access-picker-search"]');
    this.table = page.locator('[data-test="slack-org-access-table"]');
    this.saveButton = page.locator('[data-test="slack-org-access-save"]');
    this.saveError = page.locator('[data-test="slack-org-access-error"]');
    this.confirm = page.locator('[data-test="slack-org-access-confirm"]');
    this.managedBanner = page.locator('[data-test="slack-managed-banner"]');
    this.channelDefaults = page.locator('[data-test="slack-channel-defaults"]');
    this.setChannelDefault = page.locator('[data-test="slack-channel-set-default"]');
    this.channelTrigger = page.locator('[data-test="slack-channel-select-trigger"]');
    this.channelDefaultOrg = page.locator('[data-test="slack-channel-default-org"]');
    this.channelSaveError = page.locator('[data-test="slack-channel-save-error"]');
    this.drawerSave = page.locator('[data-test="o-drawer-primary-btn"]');
    this.notIncluded = page.locator('[data-test="slack-not-included"]');
    this.copyRequest = page.locator('[data-test="slack-copy-request"]');
  }

  /** Settings › Slack in `_meta`, where an instance workspace shows the Organizations card (M1). */
  async openOrgAccess() {
    await this.settings.goto(META_ORG);
    await expect(this.root).toBeVisible({ timeout: 30000 });
    await expect(this.mode).toBeVisible({ timeout: 30000 });
  }

  async chooseSelected() {
    await this.modeSelected.click();
    await expect(this.modeSelected).toHaveAttribute('data-state', 'on');
    await expect(this.picker).toBeVisible();
  }

  /** Picks the org whose name is `name` in the searchable picker; the table lists it as not saved. */
  async addOrg(name) {
    await this.pickerTrigger.click();
    await this.pickerSearch.fill(name);
    const option = this.page.locator(`[data-test="slack-org-access-picker-option"][data-test-label="${name}"]`);
    await expect(option).toBeVisible({ timeout: 20000 });
    await option.click();
    await this.page.keyboard.press('Escape');
    await expect(this.tableRow(name)).toContainText('Not saved');
  }

  /** Save sends row 24 (a preview first only when orgs are removed); resolves with the PUT's view. */
  async save() {
    const put = this.page.waitForResponse(
      (r) => r.request().method() === 'PUT' && /\/slack\/installations\/[^/]+\/org-access$/.test(new URL(r.url()).pathname),
      { timeout: 30000 },
    );
    await this.saveButton.click();
    const response = await put;
    expect(response.status(), await response.text()).toBe(200);
    await expect(this.saveError).toHaveCount(0);
    return response.json();
  }

  tableRow(name) {
    return this.table.locator('tbody:not([data-test="o2-table-skeleton-body"]) tr').filter({ hasText: name });
  }

  /** M2: the managed banner names the team, and the installation-wide controls are gone. */
  async expectManagedCard(team) {
    await expect(this.managedBanner).toBeVisible({ timeout: 30000 });
    await expect(this.managedBanner).toContainText('Managed by your instance admin.');
    await expect(this.managedBanner).toContainText(team);
    for (const id of ['slack-update-credentials', 'slack-reinstall', 'slack-uninstall', 'slack-disconnect-org', 'slack-connected-orgs']) {
      await expect(this.page.locator(`[data-test="${id}"]`)).toHaveCount(0);
    }
    await expect(this.root).toHaveCount(0);
    await expect(this.page.locator('[data-test="slack-test-connection"]')).toBeVisible();
  }

  /** Set channel default on `channel` (a mock channel name, without `#`) for this org, answers in thread. */
  async mapChannel(channel) {
    await this.setChannelDefault.click();
    await expect(this.channelDefaultOrg).toBeVisible({ timeout: 15000 });
    await this.channelTrigger.click();
    const option = this.page.locator(`[data-test="slack-channel-select-option"][data-test-label="#${channel}"]`);
    await expect(option).toBeVisible({ timeout: 20000 });
    await option.click();
    await this.page.locator('[data-test="slack-channel-answer-thread"]').click();
    const put = this.page.waitForResponse(
      (r) => r.request().method() === 'PUT' && /\/channel-defaults\/[^/]+$/.test(new URL(r.url()).pathname),
      { timeout: 30000 },
    );
    await this.drawerSave.click();
    const response = await put;
    expect(response.status(), await response.text()).toBe(200);
    await expect(this.channelSaveError).toHaveCount(0);
    return response.json();
  }

  channelRow(channel) {
    return this.channelDefaults
      .locator('tbody:not([data-test="o2-table-skeleton-body"]) tr')
      .filter({ hasText: `#${channel}` });
  }

  /** M4: A1 with the not-included banner naming the team and this org, and Copy request. */
  async expectNotIncluded(team, org) {
    await expect(this.notIncluded).toBeVisible({ timeout: 30000 });
    await expect(this.notIncluded).toContainText(`${team} is set up for this server by your instance admin`);
    if (org) await expect(this.notIncluded).toContainText(`${org} is not included yet`);
    await expect(this.copyRequest).toBeVisible();
    await expect(this.managedBanner).toHaveCount(0);
  }
}

module.exports = { SlackOrgAccessPage, META_ORG };
