const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { FirstEventPage } = require('../../pages/generalPages/firstEventPage.js');
const { authedRequest } = require('../utils/cloud-auth.js');

const base = () => process.env.ZO_BASE_URL.replace(/\/$/, '');
const ingestionBase = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');

test.describe('First event diagnosis', () => {
    test('Troubleshoot after a real 401 on the nginx guide shows the cause, Copy config and Still stuck', {
        tag: ['@onboarding', '@ingestion', '@all', '@P1'],
    }, async ({ page, request }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        // rejections are kept only for orgs with no data, so the 401 must land on a fresh org
        const created = await authedRequest(page, 'post', `${base()}/api/organizations`, { data: { name: `e2e_diag401_${Date.now()}` } });
        expect(created.ok()).toBeTruthy();
        const createdBody = await created.json();
        const orgId = createdBody.identifier || (createdBody.data && createdBody.data.identifier);
        try {
            const bad = Buffer.from(`${process.env.ZO_ROOT_USER_EMAIL}:not-the-token`).toString('base64');
            const res = await request.post(`${ingestionBase()}/api/${orgId}/nginx/_json`, {
                headers: { Authorization: `Basic ${bad}`, 'Content-Type': 'application/json' },
                data: [{ log: 'rejected e2e' }],
            });
            expect(res.status()).toBe(401);

            await navigateToBase(page);
            const fe = new FirstEventPage(page);
            await fe.openGuide('/ingestion/servers/nginx', orgId);
            await fe.expectState('waiting');
            await fe.clickTroubleshoot();

            await fe.expectState('rejected');
            await fe.expectDiagnosis({ trigger: 'troubleshoot' });
            await expect(fe.summary).toContainText('401 invalid credentials');
            await expect(fe.summary).toContainText(`/api/${orgId}/nginx/_json`);
            await expect(fe.diagnosisFix).toContainText('Fluent Bit');
            await expect(fe.diagnosisCopyBtn).toHaveText(/Copy config/);
            await expect(fe.stillStuck).toContainText('Still stuck?');
            await expect(fe.docsLink).toHaveText(/nginx docs/);
            await expect(fe.docsLink).toHaveAttribute('target', '_blank');
            await expect(fe.docsLink).toHaveAttribute('rel', 'noopener noreferrer');
            await expect(fe.contactSupportLink).toHaveCount(0);
            await expect(fe.troubleshootBtn).toHaveCount(0);
            testLogger.info('Troubleshoot diagnosis verified');
        } finally {
            await authedRequest(page, 'delete', `${base()}/api/organizations/${orgId}`).catch(() => {});
        }
    });

    test('a fresh org with no rejections reads no-requests at 120 s with org id and endpoint', {
        tag: ['@onboarding', '@ingestion', '@all', '@P2'],
    }, async ({ page }, testInfo) => {
        test.setTimeout(240000);
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `e2e_diag_${Date.now()}`;
        const created = await authedRequest(page, 'post', `${base()}/api/organizations`, { data: { name } });
        expect(created.ok()).toBeTruthy();
        const body = await created.json();
        const orgId = body.identifier || (body.data && body.data.identifier);
        try {
            await navigateToBase(page);
            const fe = new FirstEventPage(page);
            await fe.openGuide('/ingestion/custom/logs/fluentbit', orgId);
            await fe.expectState('waiting');
            await fe.expectState('no-requests', 140000);
            await fe.expectDiagnosis({ trigger: 'auto' });
            await expect(fe.diagnosisOrgId).toHaveText(orgId);
            await expect(fe.diagnosisEndpoint).not.toHaveText('');
            await expect(fe.diagnosisFix).toHaveText('Check that your command uses this org id and endpoint.');
            await expect(fe.contactSupportLink).toHaveCount(0);
        } finally {
            await authedRequest(page, 'delete', `${base()}/api/organizations/${orgId}`).catch(() => {});
        }
    });
});

