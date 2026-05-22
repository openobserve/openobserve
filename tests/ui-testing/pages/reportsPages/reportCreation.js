const testLogger = require('../../playwright-tests/utils/test-logger.js');

/**
 * Create a report via API for testing purposes.
 * Uses the apiCleanup instance for authenticated requests.
 * @param {Object} api - apiCleanup instance
 * @param {string} reportName - Unique name for the report
 * @param {string} folderId - Folder ID (defaults to "default")
 * @returns {Promise<Object>} { success, reportName, error }
 */
export async function createReportViaApi(api, reportName, folderId = 'default') {
    testLogger.info('Creating report via API', { reportName, folderId });

    try {
        const dashboards = await api.fetchDashboardsInFolder(folderId);
        if (dashboards.length === 0) {
            testLogger.error('No dashboards found in folder, cannot create report', { folderId });
            return { success: false, error: 'No dashboards available' };
        }

        const dashboard = dashboards[0];
        const inner = dashboard[`v${dashboard.version}`] || dashboard;
        if (!inner.dashboardId && !inner.dashboard_id) {
            testLogger.error('Dashboard missing required fields', { dashboard });
            return { success: false, error: 'Dashboard missing dashboard_id' };
        }

        const dashboardId = inner.dashboardId || inner.dashboard_id;
        const dashboardTabs = inner.tabs || [{ tabId: 'default' }];
        testLogger.info('Using dashboard for report', { dashboardId, title: inner.title });

        const payload = {
            name: reportName,
            description: '',
            dashboards: [{
                folder: folderId,
                dashboard: dashboardId,
                tabs: [dashboardTabs[0]?.tabId || dashboardTabs[0]?.tab_id || 'default'],
                variables: [],
                timerange: {
                    type: 'relative',
                    period: '30m',
                    from: 0,
                    to: 0
                },
                report_type: 'pdf',
                email_attachment_type: 'standard'
            }],
            destinations: [{ email: api.email }],
            enabled: true,
            imagePreview: false,
            title: `Test Report ${reportName}`,
            message: '',
            orgId: api.org,
            frequency: { interval: 1, type: 'once', cron: '' },
            timezone: 'UTC',
            timezoneOffset: 0,
            lastTriggeredAt: null,
            owner: api.email,
            lastEditedBy: api.email
        };

        const response = await api._fetch(
            `${api.baseUrl}/api/v2/${api.org}/reports?folder=${encodeURIComponent(folderId)}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': api.authHeader,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            }
        );

        if (!response.ok) {
            const errorBody = await response.text();
            testLogger.error('Failed to create report via API', { reportName, status: response.status, body: errorBody });
            return { success: false, error: `HTTP ${response.status}: ${errorBody}` };
        }

        const result = await response.json();
        testLogger.info('Report created via API', { reportName, result });
        return { success: true, reportName };
    } catch (error) {
        testLogger.error('Failed to create report via API', { reportName, error: error.message });
        return { success: false, error: error.message };
    }
}
