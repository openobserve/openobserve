const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * Create a uniquely-named team via the Teams list "Add" drawer.
 * Orchestrates page-object calls only — no selectors live in the spec.
 */
async function createTeam(pm, name) {
  await pm.onCallTeamsPage.clickAddTeam();
  await pm.onCallTeamFormPage.expectDrawerVisible();
  await pm.onCallTeamFormPage.fillName(name);
  await pm.onCallTeamFormPage.submit();
  await pm.onCallTeamsPage.expectTeamRowVisible(name);
}

function uniqueTeamName(prefix = 'pw_team_') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

test.describe('OnCall Management testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.onCallTeamsPage.gotoTeamsPage();
    await pm.onCallTeamsPage.expectTeamsPageVisible();
    testLogger.info('Test setup completed');
  });

  test.afterEach(async (_fixtures, testInfo) => {
    if (testInfo.status) {
      testLogger.testEnd(testInfo.title, testInfo.status, testInfo.duration);
    }
  });

  test('should create a team and show it on the teams list', { tag: ['@oncall', '@all', '@P0'] }, async () => {
    const teamName = uniqueTeamName();
    testLogger.info('Creating a team', { teamName });

    await createTeam(pm, teamName);

    await pm.onCallTeamsPage.expectTeamRowVisible(teamName);
    testLogger.info('Team creation test completed');

    await pm.onCallTeamsPage.deleteTeamByName(teamName);
  });

  test('should open a team and render its five tabs', { tag: ['@oncall', '@all', '@P0'] }, async () => {
    const teamName = uniqueTeamName();
    await createTeam(pm, teamName);

    await pm.onCallTeamsPage.openTeamByName(teamName);
    await pm.onCallTeamDetailPage.expectDetailTitle(teamName);
    await pm.onCallTeamDetailPage.expectTabsVisible();
    await pm.onCallTeamDetailPage.expectCoverageVisible();
    testLogger.info('Team detail tabs test completed');

    await pm.onCallTeamsPage.deleteTeamByName(teamName);
  });

  test('should add a member to a team', { tag: ['@oncall', '@all', '@P0'] }, async () => {
    const teamName = uniqueTeamName();
    await createTeam(pm, teamName);

    await pm.onCallTeamsPage.openTeamByName(teamName);
    await pm.onCallTeamDetailPage.openTab('members');
    await pm.onCallMembersPage.expectMembersVisible();

    const email = await pm.onCallMembersPage.addFirstMember();
    await pm.onCallMembersPage.expectMemberRowVisible(email);
    testLogger.info('Add member test completed', { email });

    await pm.onCallTeamsPage.deleteTeamByName(teamName);
  });

  test('should edit a team name and description', { tag: ['@oncall', '@all', '@P1'] }, async () => {
    const teamName = uniqueTeamName();
    const newName = uniqueTeamName('pw_team_renamed_');
    await createTeam(pm, teamName);

    await pm.onCallTeamsPage.openTeamByName(teamName);
    await pm.onCallTeamDetailPage.clickEdit();
    await pm.onCallTeamFormPage.expectDrawerVisible();
    await pm.onCallTeamFormPage.fillName(newName);
    await pm.onCallTeamFormPage.fillDescription('E2E edited description');
    await pm.onCallTeamFormPage.submit();

    await pm.onCallTeamDetailPage.expectDetailTitle(newName);
    testLogger.info('Edit team test completed', { newName });

    await pm.onCallTeamsPage.deleteTeamByName(newName);
  });

  test('should delete a team after confirmation', { tag: ['@oncall', '@all', '@P1'] }, async () => {
    const teamName = uniqueTeamName();
    await createTeam(pm, teamName);

    await pm.onCallTeamsPage.deleteTeamByName(teamName);
    await pm.onCallTeamsPage.expectTeamRowNotVisible(teamName);
    testLogger.info('Delete team test completed');
  });

  test('should filter the teams list by search', { tag: ['@oncall', '@all', '@P1'] }, async () => {
    const needleName = uniqueTeamName('pw_needle_');
    const otherName = uniqueTeamName('pw_other_');
    await createTeam(pm, needleName);
    await createTeam(pm, otherName);

    await pm.onCallTeamsPage.searchTeams('needle');
    await pm.onCallTeamsPage.expectTeamRowVisible(needleName);
    await pm.onCallTeamsPage.expectTeamRowNotVisible(otherName);
    testLogger.info('Search filter test completed');

    await pm.onCallTeamsPage.deleteTeamByName(needleName);
    await pm.onCallTeamsPage.deleteTeamByName(otherName);
  });
});
