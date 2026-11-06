// AO_BUILD names the served build ("enterprise" or "oss"), since one spec checks both and each runs only its case.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const { AutoObserveTargetsPage } = require('../../pages/autoobservePages/autoobserveTargetsPage.js');

const ORG = process.env.AO_ORG || 'demo-org';
const BUILD = process.env.AO_BUILD || 'enterprise';
// Written by the noDataAlert vitest case, so the seed is exactly what the builder makes.
const prefill = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'autoobserve-no-data-prefill.json'), 'utf8'),
);
const QUERY = '"service_name" = \'svc-ingest-b\' HAVING count(*) = 0';

test.describe('AutoObserve CTA targets: the alert form from a prefill', { tag: ['@autoobserve'] }, () => {
  test('enterprise: the form says AutoObserve suggested it and carries its query and origin', async ({ page }) => {
    test.skip(BUILD !== 'enterprise', 'enterprise build only');
    const form = new AutoObserveTargetsPage(page);
    await form.openAlertFormWith(ORG, prefill);

    await form.expectToast('Suggested by AutoObserve for svc-ingest-b');
    await form.expectQuery(QUERY);
    expect(await form.descriptionValue()).toBe(
      'Created from an AutoObserve suggestion for svc-ingest-b on Nov 6.',
    );
  });

  test('OSS: the same prefill shows no AutoObserve wording', async ({ page }) => {
    test.skip(BUILD !== 'oss', 'OSS build only');
    const form = new AutoObserveTargetsPage(page);
    await form.openAlertFormWith(ORG, prefill);

    await form.expectToast('Query imported into the alert form');
    await form.expectQuery(QUERY);
    await expect(form.body).not.toContainText('AutoObserve');
    expect(await form.descriptionValue()).toBe('');
  });
});
