const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { FirstEventPage } = require('../../pages/generalPages/firstEventPage.js');
const {
    ingest,
    withFreshOrg,
    targetProbe,
    waitForStreamWithRecords,
} = require('../utils/first-event-helpers.js');

test.describe('Ingestion First-Event Status testcases', () => {
    test.describe.configure({ mode: 'parallel' });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        testLogger.info('Test setup completed');
    });

    test('turns green on the curl test guide with test-kind markers and "Connect your real source"', {
        tag: ['@first-event-status', '@ingestion', '@all', '@P0'],
    }, async ({ page }) => {
        testLogger.info('Opening the curl test guide on a fresh org');
        await withFreshOrg(page, 'fe_curl', async (orgId) => {
            const fe = new FirstEventPage(page);
            const baseline = targetProbe(page, 'logs', 'default');
            await fe.openGuide('/ingestion/custom/logs/curl', orgId);
            await fe.expectState('waiting');
            await expect(fe.bar).toHaveAttribute('data-kind', 'test');
            await baseline;

            await ingest(page, orgId, 'default', [{ level: 'info', log: 'first event e2e curl' }]);
            await fe.expectState('received', 15000);
            await expect(fe.bar).toHaveAttribute('data-kind', 'test');
            await expect(fe.summary).toContainText('default');
            await expect(fe.firstRecord).toContainText('first event e2e curl');
            await expect(fe.openBtn).toHaveText(/Open in Logs/);
            await expect(fe.connectSourceBtn).toBeVisible();
            await expect(fe.connectSourceBtn).toContainText('Connect your real source');
            await expect(fe.setupAnotherBtn).toHaveCount(0);
            testLogger.info('Curl test guide turned green with test-kind markers');
        });
    });

    test.fixme('idle state unreachable in e2e: useFirstEventWatch.ts:241 hasRecords reads stream-list doc_num (no SQL COUNT fallback unlike confirmNewStream), which stays 0 until the 10-min memtable TTL flush', {
        tag: ['@first-event-status', '@ingestion', '@all', '@P1'],
    }, async ({ page }) => {
        testLogger.info('Ingesting before mount so the baseline probe sees an existing stream');
        await withFreshOrg(page, 'fe_idle', async (orgId) => {
            await ingest(page, orgId, 'default', [{ level: 'info', log: 'pre-existing record' }]);
            expect(await waitForStreamWithRecords(page, orgId, 'default')).toBe(true);

            const fe = new FirstEventPage(page);
            await fe.openGuide('/ingestion/custom/logs/curl', orgId);
            await fe.expectState('idle');
            await expect(fe.checkNowBtn).toBeVisible();
            await expect(fe.troubleshootBtn).toHaveCount(0);

            await fe.clickCheckNow();
            await fe.expectState('waiting');
            await expect(fe.checkNowBtn).toHaveCount(0);

            await ingest(page, orgId, 'default', [{ level: 'info', log: 'second record after check now' }]);
            await fe.expectState('received', 15000);
            await expect(fe.summary).toContainText('default');
            testLogger.info('Idle held on pre-existing data, then Check now engaged and received');
        });
    });

    test('Troubleshoot on a fresh tracked org shows no-requests immediately with org id and endpoint', {
        tag: ['@first-event-status', '@ingestion', '@all', '@P1'],
    }, async ({ page }) => {
        testLogger.info('Opening the fluentbit guide on a fresh, data-free org');
        await withFreshOrg(page, 'fe_noreq', async (orgId) => {
            const fe = new FirstEventPage(page);
            await fe.openGuide('/ingestion/custom/logs/fluentbit', orgId);
            await fe.expectState('waiting');
            await fe.clickTroubleshoot();
            await fe.expectState('no-requests');
            await fe.expectDiagnosis({ trigger: 'troubleshoot' });
            await expect(fe.summary).toContainText('Nothing has arrived');
            await expect(fe.diagnosisOrgId).toHaveText(orgId);
            await expect(fe.diagnosisEndpoint).not.toHaveText('');
            await expect(fe.diagnosisFix).toHaveText('Check that your command uses this org id and endpoint.');
            await expect(fe.diagnosisCopyBtn).toBeVisible();
            await expect(fe.stillStuck).toContainText('Still stuck?');
            await expect(fe.docsLink).toBeVisible();
            await expect(fe.docsLink).toHaveAttribute('target', '_blank');
            await expect(fe.troubleshootBtn).toHaveCount(0);
            testLogger.info('Troubleshoot showed no-requests immediately');
        });
    });

    test.fixme('Ask AI button — not wired in OSS: FirstEventStatus.vue:360 requires enterprise + ai_enabled', {
        tag: ['@first-event-status', '@all', '@P2'],
    }, async ({ page }) => {
        testLogger.info('Ask AI CTA in the Still stuck row (enterprise + ai_enabled only)');
        await withFreshOrg(page, 'fe_askai', async (orgId) => {
            const fe = new FirstEventPage(page);
            await fe.openGuide('/ingestion/custom/logs/fluentbit', orgId);
            await fe.expectState('waiting');
            await fe.clickTroubleshoot();
            await fe.expectState('no-requests');
            await expect(fe.askAiBtn).toBeVisible();
            testLogger.info('Ask AI button visible after diagnosis');
        });
    });
});
