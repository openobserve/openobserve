import { expect } from '@playwright/test';

const testLogger = require('../../playwright-tests/utils/test-logger.js');

/**
 * OnCall → Teams list. Owns navigation to the list, the create/edit/delete
 * entry points, and client-side search filtering.
 */
export class OnCallTeamsPage {
  constructor(page) {
    this.page = page;
    this.teamsPage = page.locator('[data-test="oncall-teams-page"]');
    this.addButton = page.locator('[data-test="oncall-teams-add-btn"]');
    this.searchInput = page.locator('[data-test="oncall-teams-search"] input');
    this.teamsTable = page.locator('[data-test="oncall-teams-table"]');
  }

  /** The list row whose name cell contains `name`. */
  teamRow(name) {
    return this.teamsTable
      .locator('[data-test^="o2-table-row-"]')
      .filter({ hasText: name })
      .first();
  }

  async gotoTeamsPage() {
    testLogger.info('Navigating to OnCall Teams list');
    await this.page.goto(
      `${process.env.ZO_BASE_URL}/web/oncall/teams?org_identifier=${process.env.ORGNAME}`,
    );
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  async expectTeamsPageVisible() {
    await expect(this.teamsPage).toBeVisible({ timeout: 30000 });
  }

  async clickAddTeam() {
    await this.addButton.waitFor({ state: 'visible', timeout: 30000 });
    await this.addButton.click();
  }

  async expectTeamRowVisible(name) {
    await expect(this.teamRow(name)).toBeVisible({ timeout: 30000 });
  }

  async expectTeamRowNotVisible(name) {
    await expect(this.teamRow(name)).not.toBeVisible({ timeout: 30000 });
  }

  /** Click a team row's name cell to open its detail view. */
  async openTeamByName(name) {
    testLogger.info('Opening team', { name });
    await this.expectTeamRowVisible(name);
    await this.teamRow(name).locator('[data-test="o2-table-cell-name"]').click();
  }

  /** Delete a team via its row action, then confirm the shared ConfirmDialog. */
  async deleteTeamByName(name) {
    testLogger.info('Deleting team', { name });
    await this.gotoTeamsPage();
    await this.expectTeamRowVisible(name);
    await this.teamRow(name).locator('[data-test^="oncall-team-delete-"]').click();
    await this.page
      .locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]')
      .click();
    await this.expectTeamRowNotVisible(name);
  }

  async searchTeams(query) {
    testLogger.info('Filtering teams by search', { query });
    await this.searchInput.fill(query);
  }
}
