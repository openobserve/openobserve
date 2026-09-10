const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("MCP Server Connection Setup testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.iamPage.gotoIamPage();
    await pm.iamPage.iamURLValidation();
    await pm.iamPage.iamPageMcpServerTab();
    // Wait for a known element — never networkidle (deployed envs poll RUM/analytics).
    await pm.mcpServerPage.waitForCard();
    testLogger.info('MCP Server page navigation completed');
  });

  test("MCP Server page renders the endpoint + token credential pane (OSS default)", { tag: ['@mcpServer', '@iam', '@all', '@P0'] }, async ({ page }) => {
    testLogger.info('Asserting OSS default render: endpoint, token pane, no OAuth tab');
    await pm.mcpServerPage.expectEndpointVisible();
    await pm.mcpServerPage.expectOAuthTabAbsent();
    await pm.mcpServerPage.expectCredentialPaneVisible();
    await pm.mcpServerPage.expectSecurityHintVisible();
    testLogger.info('MCP Server OSS render verified');
  });

  test("Generate a dedicated token → post-generation panel with rbac-note (OSS)", { tag: ['@mcpServer', '@iam', '@all', '@P0'] }, async ({ page }) => {
    testLogger.info('Generating a dedicated token');
    await pm.mcpServerPage.clickGenerate();
    const generated = await pm.mcpServerPage.waitForGenerateOutcome();
    if (generated) {
      await pm.mcpServerPage.expectPostGenerationPanel();
      await pm.mcpServerPage.expectPlaceholderReplaced();
    } else {
      testLogger.info('Backend rejected generation (service accounts disabled) — asserting error banner');
      await pm.mcpServerPage.expectErrorBanner();
    }
    testLogger.info('Generate-token flow verified');
  });

  test("Switching the MCP client re-renders the config snippet", { tag: ['@mcpServer', '@iam', '@all', '@P1'] }, async ({ page }) => {
    testLogger.info('Verifying the config snippet re-renders per client');
    await pm.mcpServerPage.expectConfigClaudeCode();
    await pm.mcpServerPage.switchClient('cursor');
    await pm.mcpServerPage.expectConfigCursor();
    await pm.mcpServerPage.switchClient('claudeCode');
    await pm.mcpServerPage.expectConfigClaudeCode();
    testLogger.info('Client switch re-render verified');
  });

  test("One-click install button is client-dependent", { tag: ['@mcpServer', '@iam', '@all', '@P1'] }, async ({ page }) => {
    testLogger.info('Verifying the one-click install button is client-dependent');
    await pm.mcpServerPage.expectInstallButtonAbsent();
    await pm.mcpServerPage.switchClient('cursor');
    await pm.mcpServerPage.expectInstallButtonVisible();
    testLogger.info('Install button visibility verified');
  });

  test("Skills command + repo button (Step 3)", { tag: ['@mcpServer', '@iam', '@all', '@P1'] }, async ({ page }) => {
    testLogger.info('Verifying the skills command and repo button');
    await pm.mcpServerPage.expectSkillsCommandVisible();
    await pm.mcpServerPage.expectSkillsRepoButtonVisible();
    testLogger.info('Skills step verified');
  });

  test("Manage / revoke navigates to Service Accounts", { tag: ['@mcpServer', '@iam', '@all', '@P1'] }, async ({ page }) => {
    testLogger.info('Generating a token then verifying Manage / revoke navigation');
    await pm.mcpServerPage.clickGenerate();
    const generated = await pm.mcpServerPage.waitForGenerateOutcome();
    if (generated) {
      await pm.mcpServerPage.clickManageAndExpectServiceAccounts();
    } else {
      testLogger.info('Generation rejected — manage button absent; asserting error banner');
      await pm.mcpServerPage.expectErrorBanner();
    }
    testLogger.info('Manage / revoke navigation verified');
  });

  test("Session credential reuse on remount (same org)", { tag: ['@mcpServer', '@iam', '@all', '@P2'] }, async ({ page }) => {
    testLogger.info('Generating a token, navigating away and back, asserting cache reuse');
    await pm.mcpServerPage.clickGenerate();
    const generated = await pm.mcpServerPage.waitForGenerateOutcome();
    if (!generated) {
      await pm.mcpServerPage.expectErrorBanner();
      return;
    }
    await pm.mcpServerPage.expectPostGenerationPanel();
    // Navigate away and back within the same org session.
    await pm.iamPage.gotoIamPage();
    await pm.iamPage.iamURLValidation();
    await pm.iamPage.iamPageMcpServerTab();
    await pm.mcpServerPage.waitForCard();
    // The minted credential is cached per org, so the post-generation panel
    // re-shows without a second mint.
    await pm.mcpServerPage.expectPostGenerationPanel();
    testLogger.info('Session credential reuse verified');
  });

  // --- Enterprise/cloud-only paths (parked as fixme placeholders) ---

  test.fixme("OAuth auth-mode tab — not wired on OSS (needs enterprise/cloud + SSO: McpServerCard.vue:70-74)", { tag: ['@mcpServer', '@iam', '@all', '@enterprise'] }, async ({ page }) => {
    testLogger.info('Asserting the OAuth auth-mode tab renders (enterprise/cloud + SSO)');
    await pm.mcpServerPage.expectOAuthTabVisible();
    testLogger.info('OAuth auth-mode tab verified');
  });

  test.fixme("Readonly scope note — not wired on OSS (needs rbac_enabled: useMcpCredential.ts:119)", { tag: ['@mcpServer', '@iam', '@all', '@enterprise'] }, async ({ page }) => {
    testLogger.info('Generating a token and asserting the readonly scope note (RBAC on)');
    await pm.mcpServerPage.clickGenerate();
    await pm.mcpServerPage.waitForGenerateOutcome();
    await pm.mcpServerPage.expectReadonlyNoteVisible();
    testLogger.info('Readonly scope note verified');
  });

  test.fixme("Unscoped warning — not wired on OSS (needs RBAC on + role failure: useMcpCredential.ts:122)", { tag: ['@mcpServer', '@iam', '@all', '@enterprise'] }, async ({ page }) => {
    testLogger.info('Generating a token and asserting the unscoped warning (RBAC on + role failure)');
    await pm.mcpServerPage.clickGenerate();
    await pm.mcpServerPage.waitForGenerateOutcome();
    await pm.mcpServerPage.expectReadonlyWarnVisible();
    testLogger.info('Unscoped warning verified');
  });
});
