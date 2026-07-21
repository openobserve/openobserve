/**
 * Edition Features Documentation Validation
 *
 * Validates the header edition button ("Get OpenObserve Enterprise (Free)" on OSS,
 * "Edition: Enterprise" on ENT), the EnterpriseUpgradeDialog it opens, and every
 * feature card's o2.ws documentation short link — each card is clicked and the
 * resulting popup must land on the expected openobserve.ai page.
 *
 * Exactly one of the two tests runs per environment: the active edition is
 * detected from the rendered header button label (see
 * EditionFeaturesPage.detectEdition) — the button label is the most direct
 * signal of what the user sees and tolerates frontend/backend build mismatches
 * (e.g. an OSS frontend bundle served by an enterprise backend).
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const {
  ENTERPRISE_FEATURES,
  HERO_LINKS,
} = require('../../pages/generalPages/editionFeaturesPage.js');

test.describe.configure({ mode: 'serial' });

/**
 * Shared dialog + feature-link validation. Edition-specific bits (button label,
 * hero panel content, hero link buttons) are passed in via editionConfig.
 */
async function validateEditionDialog(page, pm, editionConfig) {
  const ef = pm.editionFeaturesPage;

  // 1. Header edition button shows the right label for this build
  testLogger.step(`Verifying header button label: ${editionConfig.buttonLabel}`);
  await ef.expectEditionButtonLabel(editionConfig.buttonLabel);

  // 2. Open the dialog and verify the edition-specific hero panel
  testLogger.step('Opening enterprise features dialog');
  await ef.openDialog();
  await ef.expectHero(editionConfig.hero);

  // 3. Validate all feature cards (presence, link icon, BETA/HA badges)
  testLogger.step(`Validating ${ENTERPRISE_FEATURES.length} feature cards`);
  for (const feature of ENTERPRISE_FEATURES) {
    await ef.expectFeatureCard(feature);
  }
  await ef.expectCloudOnlyFeatureHidden();

  // 4. Click every feature card and verify the popup lands on the right
  //    openobserve.ai page (o2.ws short link redirect). Soft assertions so a
  //    single broken link reports alongside the rest instead of masking them.
  testLogger.step('Verifying documentation link navigation for every feature');
  for (const feature of ENTERPRISE_FEATURES) {
    const finalUrl = await ef.captureFeatureLinkUrl(feature.name, feature.expectedPath);
    testLogger.info(`Feature link resolved`, { feature: feature.name, slug: feature.slug, finalUrl });
    expect
      .soft(finalUrl, `"${feature.name}" (o2.ws/${feature.slug}) should land on openobserve.ai`)
      .toContain('openobserve.ai');
    expect
      .soft(finalUrl, `"${feature.name}" (o2.ws/${feature.slug}) should land on ${feature.expectedPath}`)
      .toContain(feature.expectedPath);
  }

  // 5. Hero panel link buttons (external links only — "Get Free License" stays
  //    unclicked because it switches the active org to the meta org)
  for (const heroLink of editionConfig.heroLinkButtons) {
    testLogger.step(`Verifying hero button link: ${heroLink.label}`);
    const finalUrl = await ef.clickAndCapturePopupUrl(heroLink.locator(ef), heroLink.expectedPath);
    testLogger.info('Hero button link resolved', { button: heroLink.label, finalUrl });
    expect
      .soft(finalUrl, `"${heroLink.label}" should land on openobserve.ai`)
      .toContain('openobserve.ai');
    expect
      .soft(finalUrl, `"${heroLink.label}" should land on ${heroLink.expectedPath}`)
      .toContain(heroLink.expectedPath);
  }
}

test.describe('Edition Features Documentation Validation', () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test('OSS - validate enterprise upsell dialog and feature documentation links', {
    tag: ['@editionFeatures', '@all', '@oss'],
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'opensource', `Runs only on OSS build (detected: ${edition})`);
    test.setTimeout(360000); // 22 external link navigations

    await validateEditionDialog(page, pm, {
      buttonLabel: 'Get OpenObserve Enterprise (Free)',
      hero: {
        heroTitle: 'Get Enterprise Edition',
        badgePattern: /Free up to \d+GB \/ day/,
        primaryButtonText: 'Download Now',
        featuresTitle: 'Unlock All Enterprise Features',
        hasLearnMore: true,
      },
      heroLinkButtons: [
        {
          label: 'Download Now',
          locator: (ef) => ef.primaryButton,
          expectedPath: HERO_LINKS.download_resources.expectedPath,
        },
        {
          label: 'Learn More',
          locator: (ef) => ef.learnMoreButton,
          expectedPath: HERO_LINKS.ent_install_guide.expectedPath,
        },
      ],
    });

    testLogger.info('OSS edition features validation completed');
  });

  test('ENT - validate edition dialog and feature documentation links', {
    tag: ['@editionFeatures', '@all', '@enterprise'],
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'enterprise', `Runs only on Enterprise build (detected: ${edition})`);
    test.setTimeout(360000); // 21 external link navigations

    // Asserts the no-license dialog variant ("Get Free License") — the CI/dev
    // enterprise environment runs without a license. A licensed environment
    // shows "Manage License" + "Contact Sales" and will fail here loudly.
    await validateEditionDialog(page, pm, {
      buttonLabel: 'Edition: Enterprise',
      hero: {
        heroTitle: 'Enterprise Features',
        badgePattern: /Free up to \d+GB \/ day/,
        primaryButtonText: 'Get Free License',
        featuresTitle: 'Available Enterprise Features',
        hasLearnMore: true,
      },
      heroLinkButtons: [
        // "Get Free License" intentionally not clicked: it switches the active
        // org to the meta org and navigates to the license page (mutates state).
        {
          label: 'Learn More',
          locator: (ef) => ef.learnMoreButton,
          expectedPath: HERO_LINKS.license_guide.expectedPath,
        },
      ],
    });

    testLogger.info('Enterprise edition features validation completed');
  });
});
