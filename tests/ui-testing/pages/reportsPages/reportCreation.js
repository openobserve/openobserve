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
        let dashboards = await api.fetchDashboardsInFolder(folderId);
        if (dashboards.length === 0) {
            testLogger.info('No dashboards in folder — creating minimal setup dashboard', { folderId });
            await api.createMinimalDashboard(`e2e_setup_dashboard_${Date.now()}`, folderId);
            dashboards = await api.fetchDashboardsInFolder(folderId);
            if (dashboards.length === 0) {
                return { success: false, error: 'Could not create a setup dashboard for report' };
            }
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

/**
 * Create a report folder (folder_type = "reports") via API.
 * Report folders are a separate namespace from dashboard folders — a report can
 * live in report folder F while the dashboard it renders lives in dashboard
 * folder D. See PR #13569.
 * @param {Object} api - apiCleanup instance
 * @param {string} folderName - Unique folder name
 * @param {string} description - Optional description
 * @returns {Promise<Object>} { success, folderId, error }
 */
export async function createReportFolderViaApi(api, folderName, description = '') {
    testLogger.info('Creating report folder via API', { folderName });

    try {
        const response = await api._fetch(`${api.baseUrl}/api/v2/${api.org}/folders/reports`, {
            method: 'POST',
            headers: {
                'Authorization': api.authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: folderName, description })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            testLogger.error('Failed to create report folder via API', { folderName, status: response.status, body: errorBody });
            return { success: false, error: `HTTP ${response.status}: ${errorBody}` };
        }

        const result = await response.json();
        const folderId = result.folderId || result.folder_id;
        if (!folderId) {
            return { success: false, error: `Report folder create returned no folderId: ${JSON.stringify(result)}` };
        }

        testLogger.info('Report folder created via API', { folderName, folderId });
        return { success: true, folderId };
    } catch (error) {
        testLogger.error('Failed to create report folder via API', { folderName, error: error.message });
        return { success: false, error: error.message };
    }
}

/**
 * Create a report bound to a SPECIFIC dashboard, optionally saved into a
 * non-default report folder.
 *
 * Differs from createReportViaApi (which picks an arbitrary existing dashboard
 * and always uses one folder id for both the dashboard and the report): here the
 * dashboard folder and the report folder are independent, which is exactly the
 * configuration PR #13569 fixed.
 *
 * @param {Object} api - apiCleanup instance
 * @param {Object} opts
 * @param {string} opts.reportName - Unique report name
 * @param {string} opts.dashboardId - Dashboard the report renders
 * @param {string} [opts.tabId="default"] - Dashboard tab id
 * @param {string} [opts.dashboardFolderId="default"] - Folder holding the dashboard
 * @param {string} [opts.reportFolderId="default"] - Folder the REPORT is saved into
 * @param {boolean} [opts.cached=true] - true => no destinations ("Cached" tab);
 *                                       false => one email destination ("Scheduled" tab)
 * @returns {Promise<Object>} { success, reportName, error }
 */
export async function createDashboardReportViaApi(api, opts) {
    const {
        reportName,
        dashboardId,
        tabId = 'default',
        dashboardFolderId = 'default',
        reportFolderId = 'default',
        cached = true,
    } = opts;

    testLogger.info('Creating dashboard-bound report via API', {
        reportName, dashboardId, dashboardFolderId, reportFolderId, cached
    });

    try {
        const payload = {
            name: reportName,
            description: '',
            dashboards: [{
                folder: dashboardFolderId,
                dashboard: dashboardId,
                tabs: [tabId],
                variables: [],
                timerange: { type: 'relative', period: '30m', from: 0, to: 0 },
                report_type: 'pdf',
                email_attachment_type: 'standard'
            }],
            // An empty destinations list is what makes a report "cached" in the
            // drawer (isCached: !report.destinations?.length) and is accepted by
            // the backend even when SMTP is disabled.
            destinations: cached ? [] : [{ email: api.email }],
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
            `${api.baseUrl}/api/v2/${api.org}/reports?folder=${encodeURIComponent(reportFolderId)}`,
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
            testLogger.error('Failed to create dashboard-bound report via API', { reportName, status: response.status, body: errorBody });
            return { success: false, error: `HTTP ${response.status}: ${errorBody}` };
        }

        testLogger.info('Dashboard-bound report created via API', { reportName, reportFolderId });
        return { success: true, reportName };
    } catch (error) {
        testLogger.error('Failed to create dashboard-bound report via API', { reportName, error: error.message });
        return { success: false, error: error.message };
    }
}
