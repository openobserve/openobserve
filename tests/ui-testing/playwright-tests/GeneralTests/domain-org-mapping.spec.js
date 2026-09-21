// Copyright 2026 OpenObserve Inc.
//
// Domain → Organization Mapping (Settings > Organization)
//
// The entire feature is cloud-only, end-to-end: the section renders only when
// `showDomainOrgMappings = config.isCloud === "true" && isMetaOrg` (a build-time
// flag that is "false" in the OSS binary), and backend persistence is
// `#[cfg(feature = "cloud")]`-only. So this spec is a gating probe plus parked
// `test.fixme` placeholders with file:line evidence for the cloud behaviors.
//
//   P0 OSS  — a real negative assertion: the section is absent on OSS (green).
//   P0 Cloud — positive-probe → clean SKIP on OSS, add happy-path on cloud.
//   P1/P2    — CRUD/validation/backend behaviors, UNWIRED in OSS → test.fixme.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('Domain to Organization Mapping testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  // ── P0: cloud-gating of the section (WIRED) ───────────────────────────────

  test('OSS - Domain to Organization mappings section is hidden (cloud-gated)', {
    tag: ['@domain-org-mapping', '@all', '@P0', '@smoke', '@oss'],
  }, async () => {
    testLogger.info('Navigating to the meta org organization settings page');
    await pm.settingsFormValidation.navigateToMetaOrgOrganizationSettings();

    testLogger.info('Asserting the cloud-gated mappings section is absent on OSS');
    await pm.settingsFormValidation.expectDomainOrgMappingsSectionAbsent();

    testLogger.info('Confirmed the Domain to Organization mappings section is hidden on OSS');
  });

  test('Cloud - Domain to Organization mappings section renders and Add works', {
    tag: ['@domain-org-mapping', '@all', '@P0', '@smoke', '@cloud'],
  }, async () => {
    testLogger.info('Probing for the cloud-gated Domain to Organization mappings section');
    await pm.settingsFormValidation.navigateToMetaOrgOrganizationSettings();
    const available = await pm.settingsFormValidation.probeDomainOrgMappingsSection();
    test.skip(!available, 'Domain to Organization mappings is a cloud-only feature — absent in this build');

    testLogger.info('Adding a domain mapping (base_role defaults to admin)');
    await pm.settingsFormValidation.addDomainOrgMapping('acme.com', process.env.ORGNAME || 'default', 'admin');

    await pm.settingsFormValidation.expectDomainOrgMappingsListVisible();
    await pm.settingsFormValidation.expectDomainOrgMappingsItemDomainVisible(0, '@acme.com');

    testLogger.info('Domain mapping added and rendered as a list row');
  });

  // ── P1: CRUD / persistence (UNWIRED in OSS → fixme) ───────────────────────

  test.fixme('Edit mapping — not wired: DomainOrgMappings.vue:173-177 (section cloud-gated, OrganizationSettings.vue:146)', {
    tag: ['@domain-org-mapping', '@all', '@P1', '@fixme'],
  }, async () => {
    testLogger.info('Editing an existing domain mapping');
    await pm.settingsFormValidation.navigateToMetaOrgOrganizationSettings();
    await pm.settingsFormValidation.addDomainOrgMapping('acme.com', process.env.ORGNAME || 'default', 'admin');

    await pm.settingsFormValidation.clickEditDomainOrgMapping(0);
    await pm.settingsFormValidation.fillDomainOrgMappingOrg('edited-org');
    await pm.settingsFormValidation.submitDomainOrgMapping();

    await pm.settingsFormValidation.expectDomainOrgMappingsItemOrgVisible(0, 'edited-org');
    testLogger.info('Edit mapping completed');
  });

  test.fixme('Delete mapping — not wired: DomainOrgMappings.vue:196-206 (section cloud-gated, OrganizationSettings.vue:146)', {
    tag: ['@domain-org-mapping', '@all', '@P1', '@fixme'],
  }, async () => {
    testLogger.info('Deleting an existing domain mapping');
    await pm.settingsFormValidation.navigateToMetaOrgOrganizationSettings();
    await pm.settingsFormValidation.addDomainOrgMapping('acme.com', process.env.ORGNAME || 'default', 'admin');

    await pm.settingsFormValidation.clickDeleteDomainOrgMapping(0);
    await pm.settingsFormValidation.confirmRemoveDomainOrgMapping();

    await pm.settingsFormValidation.expectDomainOrgMappingsEmptyVisible();
    testLogger.info('Delete mapping completed');
  });

  test.fixme('Duplicate-domain rejection — not wired: DomainOrgMappingDialog.vue:159-164 (section cloud-gated)', {
    tag: ['@domain-org-mapping', '@all', '@P1', '@fixme'],
  }, async () => {
    testLogger.info('Attempting to add a duplicate domain mapping');
    await pm.settingsFormValidation.navigateToMetaOrgOrganizationSettings();
    await pm.settingsFormValidation.addDomainOrgMapping('acme.com', process.env.ORGNAME || 'default', 'admin');

    await pm.settingsFormValidation.clickAddDomainOrgMapping();
    await pm.settingsFormValidation.fillDomainOrgMappingDomain('acme.com');
    await pm.settingsFormValidation.fillDomainOrgMappingOrg(process.env.ORGNAME || 'default');
    await pm.settingsFormValidation.clickDomainOrgMappingPrimary();

    // The dialog stays open and an error toast surfaces the duplicate-domain message.
    await pm.settingsFormValidation.expectDomainOrgMappingDialogVisible();
    await pm.settingsFormValidation.expectErrorToast();
    testLogger.info('Duplicate-domain rejection completed');
  });

  test.fixme('Backend persists domain_org_mappings on host Save — not wired: settings.rs:157-207 (#[cfg(feature = "cloud")] only)', {
    tag: ['@domain-org-mapping', '@all', '@P1', '@fixme'],
  }, async () => {
    testLogger.info('Saving a domain mapping through the host Save button');
    await pm.settingsFormValidation.navigateToMetaOrgOrganizationSettings();
    await pm.settingsFormValidation.addDomainOrgMapping('acme.com', process.env.ORGNAME || 'default', 'admin');

    // The host save POSTs domain_org_mappings only when the section rendered;
    // backend round-trip/validation (invalid org_id → 400) is cloud-only.
    await pm.settingsFormValidation.clickOrgSettingsSave();
    await pm.settingsFormValidation.expectSuccessToast();
    testLogger.info('Host save with domain_org_mappings completed');
  });

  // ── P2: edge cases / nice-to-have (UNWIRED in OSS → fixme) ────────────────

  test.fixme('Domain validation — not wired: DomainOrgMappings.schema.ts + DomainManagement.schema.ts isValidDomain', {
    tag: ['@domain-org-mapping', '@all', '@P2', '@fixme'],
  }, async () => {
    testLogger.info('Testing invalid domain format validation');
    await pm.settingsFormValidation.navigateToMetaOrgOrganizationSettings();
    await pm.settingsFormValidation.clickAddDomainOrgMapping();
    await pm.settingsFormValidation.fillDomainOrgMappingDomain('not_a_domain');
    await pm.settingsFormValidation.fillDomainOrgMappingOrg(process.env.ORGNAME || 'default');
    await pm.settingsFormValidation.clickDomainOrgMappingPrimary();

    await pm.settingsFormValidation.expectDomainOrgMappingDomainError();
    testLogger.info('Invalid domain format shows a validation error');
  });

  test.fixme('allowed_user role displays as "User" badge — not wired: DomainOrgMappings.vue badgeRole()', {
    tag: ['@domain-org-mapping', '@all', '@P2', '@fixme'],
  }, async () => {
    testLogger.info('Adding a mapping with the allowed_user base role');
    await pm.settingsFormValidation.navigateToMetaOrgOrganizationSettings();
    await pm.settingsFormValidation.addDomainOrgMapping('acme.com', process.env.ORGNAME || 'default', 'allowed_user');

    await pm.settingsFormValidation.expectDomainOrgMappingsItemRoleBadge(0, 'User');
    testLogger.info('allowed_user role renders the "User" badge');
  });

  test.fixme('Optional user_group dropped from payload when empty — not wired: DomainOrgMappingDialog.vue onSubmit normalization', {
    tag: ['@domain-org-mapping', '@all', '@P2', '@fixme'],
  }, async () => {
    testLogger.info('Adding a mapping with no user group');
    await pm.settingsFormValidation.navigateToMetaOrgOrganizationSettings();
    await pm.settingsFormValidation.addDomainOrgMapping('acme.com', process.env.ORGNAME || 'default', 'admin');

    // An empty user_group is normalized away (undefined) so no group tag renders.
    await pm.settingsFormValidation.expectDomainOrgMappingsItemGroupAbsent(0);
    testLogger.info('Empty user_group renders no group tag on the row');
  });

  test.fixme('Sign-in auto-add via domain match — not wired: jwt.rs:837-838 process_domain_org_mapping (#[cfg(feature = "cloud")] only)', {
    tag: ['@domain-org-mapping', '@all', '@P2', '@fixme'],
  }, async ({ page }) => {
    testLogger.info('Verifying a mapped domain round-trips so sign-in auto-add can read it');
    // The actual auto-add (a new user with a mapped-domain email lands in the
    // target org/role/group) runs in the backend sign-in path (jwt.rs
    // process_domain_org_mapping, cloud-only). The concrete, assertable
    // prerequisite is that the mapping round-trips through /api/_meta/settings.
    const baseUrl = (process.env['INGESTION_URL'] || process.env['ZO_BASE_URL']).replace(/\/+$/, '');
    const auth = Buffer.from(
      `${process.env['ZO_ROOT_USER_EMAIL']}:${process.env['ZO_ROOT_USER_PASSWORD']}`,
    ).toString('base64');
    const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };

    const post = await page.request.post(`${baseUrl}/api/_meta/settings`, {
      headers,
      data: {
        domain_org_mappings: [{ domain: 'acme.com', org_id: process.env.ORGNAME || 'default', base_role: 'admin' }],
      },
    });
    expect(post.status(), 'POST /api/_meta/settings should accept the mapping').toBe(200);

    const read = await page.request.get(`${baseUrl}/api/_meta/settings`, { headers });
    expect(read.status(), 'GET /api/_meta/settings should round-trip the mapping').toBe(200);
    const body = await read.json();
    expect(body.domain_org_mappings, 'round-tripped settings should include the mapping').toContainEqual(
      expect.objectContaining({ domain: 'acme.com' }),
    );

    testLogger.info('Sign-in auto-add prerequisite (mapping round-trip) verified');
  });
});
