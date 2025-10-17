const fetch = require('node-fetch');
const testLogger = require('../playwright-tests/utils/test-logger.js');

class APICleanup {
    constructor() {
        this.baseUrl = process.env.ZO_BASE_URL;
        this.org = process.env.ORGNAME;
        this.email = process.env.ZO_ROOT_USER_EMAIL;
        this.password = process.env.ZO_ROOT_USER_PASSWORD;
        this.authHeader = 'Basic ' + Buffer.from(`${this.email}:${this.password}`).toString('base64');
    }

    /**
     * Fetch all destinations and build template-destination mapping
     * @returns {Promise<Object>} Object with destinations array and templateToDestinations map
     */
    async fetchDestinationsWithTemplateMapping() {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/alerts/destinations?page_num=1&page_size=100000&sort_by=name&desc=false&module=alert`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch destinations', { status: response.status });
                return { destinations: [], templateToDestinations: {} };
            }

            const destinations = await response.json();

            // Build map of template name -> destination names
            const templateToDestinations = {};
            for (const dest of destinations) {
                if (dest.template) {
                    if (!templateToDestinations[dest.template]) {
                        templateToDestinations[dest.template] = [];
                    }
                    templateToDestinations[dest.template].push(dest.name);
                }
            }

            return { destinations, templateToDestinations };
        } catch (error) {
            testLogger.error('Failed to fetch destinations', { error: error.message });
            return { destinations: [], templateToDestinations: {} };
        }
    }

    /**
     * Fetch all alert folders
     * @returns {Promise<Array>} Array of folder objects with folderId and name
     */
    async fetchAlertFolders() {
        try {
            const response = await fetch(`${this.baseUrl}/api/v2/${this.org}/folders/alerts`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch alert folders', { status: response.status });
                return [];
            }

            const data = await response.json();
            return data.list || [];
        } catch (error) {
            testLogger.error('Failed to fetch alert folders', { error: error.message });
            return [];
        }
    }

    /**
     * Fetch alerts in a specific folder
     * @param {string} folderId - The folder ID
     * @returns {Promise<Array>} Array of alert objects
     */
    async fetchAlertsInFolder(folderId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/v2/${this.org}/alerts?sort_by=name&desc=false&name=&folder=${folderId}`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch alerts in folder', { folderId, status: response.status });
                return [];
            }

            const data = await response.json();
            return data.list || [];
        } catch (error) {
            testLogger.error('Failed to fetch alerts in folder', { folderId, error: error.message });
            return [];
        }
    }

    /**
     * Delete a single alert
     * @param {string} alertId - The alert ID
     * @param {string} folderId - The folder ID
     * @returns {Promise<Object>} Deletion result
     */
    async deleteAlert(alertId, folderId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/v2/${this.org}/alerts/${alertId}?folder=${folderId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();
            return result;
        } catch (error) {
            testLogger.error('Failed to delete alert', { alertId, folderId, error: error.message });
            return { code: 500, error: error.message };
        }
    }

    /**
     * Delete a folder
     * @param {string} folderId - The folder ID
     * @returns {Promise<Object>} Deletion result
     */
    async deleteFolder(folderId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/v2/${this.org}/folders/alerts/${folderId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            // API returns plain text "Folder deleted" instead of JSON
            const text = await response.text();

            // If successful, return standardized response
            if (response.ok) {
                return { code: 200, message: text };
            }

            // Try to parse as JSON for error responses
            try {
                const jsonResult = JSON.parse(text);
                return jsonResult;
            } catch {
                return { code: response.status, message: text };
            }
        } catch (error) {
            testLogger.error('Failed to delete folder', { folderId, error: error.message });
            return { code: 500, error: error.message };
        }
    }

    /**
     * Fetch all dashboard folders
     * @returns {Promise<Array>} Array of folder objects
     */
    async fetchDashboardFolders() {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/folders`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch dashboard folders', { status: response.status });
                return [];
            }

            const folders = await response.json();
            return folders || [];
        } catch (error) {
            testLogger.error('Failed to fetch dashboard folders', { error: error.message });
            return [];
        }
    }

    /**
     * Fetch all dashboards in a specific folder
     * @param {string} folderName - The folder name (e.g., 'default')
     * @returns {Promise<Array>} Array of dashboard objects
     */
    async fetchDashboardsInFolder(folderName = 'default') {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/dashboards?page_num=0&page_size=1000&sort_by=name&desc=false&name=&folder=${folderName}`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch dashboards', { folder: folderName, status: response.status });
                return [];
            }

            const data = await response.json();
            return data.dashboards || [];
        } catch (error) {
            testLogger.error('Failed to fetch dashboards', { folder: folderName, error: error.message });
            return [];
        }
    }

    /**
     * Delete a single dashboard
     * @param {string} dashboardId - The dashboard ID
     * @param {string} folderId - The folder ID
     * @returns {Promise<Object>} Deletion result
     */
    async deleteDashboard(dashboardId, folderId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/dashboards/${dashboardId}?folder=${folderId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to delete dashboard', { dashboardId, folderId, status: response.status });
                return { code: response.status, message: 'Failed to delete dashboard' };
            }

            const result = await response.json();
            return result;
        } catch (error) {
            testLogger.error('Failed to delete dashboard', { dashboardId, folderId, error: error.message });
            return { code: 500, error: error.message };
        }
    }

    /**
     * Fetch all reports
     * @returns {Promise<Array>} Array of report objects
     */
    async fetchReports() {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/reports`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch reports', { status: response.status });
                return [];
            }

            const reports = await response.json();
            return reports || [];
        } catch (error) {
            testLogger.error('Failed to fetch reports', { error: error.message });
            return [];
        }
    }

    /**
     * Delete a single report
     * @param {string} reportName - The report name
     * @returns {Promise<Object>} Deletion result
     */
    async deleteReport(reportName) {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/reports/${reportName}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to delete report', { reportName, status: response.status });
                return { code: response.status, message: 'Failed to delete report' };
            }

            const result = await response.json();
            return result;
        } catch (error) {
            testLogger.error('Failed to delete report', { reportName, error: error.message });
            return { code: 500, error: error.message };
        }
    }

    /**
     * Clean up all reports owned by the automation test user
     * Deletes all reports where owner matches ZO_ROOT_USER_EMAIL
     */
    async cleanupReports() {
        testLogger.info('Starting reports cleanup', { owner: this.email });

        try {
            // Fetch all reports
            const reports = await this.fetchReports();
            testLogger.info('Fetched reports', { total: reports.length });

            // Filter reports owned by automation user
            const ownedReports = reports.filter(r => r.owner === this.email);
            testLogger.info('Found reports owned by automation user', { count: ownedReports.length });

            if (ownedReports.length === 0) {
                testLogger.info('No reports to clean up');
                return;
            }

            // Delete each report
            let deletedCount = 0;
            let failedCount = 0;

            for (const report of ownedReports) {
                const result = await this.deleteReport(report.name);

                if (result.code === 200) {
                    deletedCount++;
                    testLogger.debug('Deleted report', {
                        id: report.report_id,
                        name: report.name
                    });
                } else {
                    failedCount++;
                    testLogger.warn('Failed to delete report', {
                        id: report.report_id,
                        name: report.name,
                        result
                    });
                }
            }

            testLogger.info('Reports cleanup completed', {
                total: ownedReports.length,
                deleted: deletedCount,
                failed: failedCount
            });

        } catch (error) {
            testLogger.error('Reports cleanup failed', { error: error.message });
        }
    }

    /**
     * Clean up all dashboards owned by the automation test user
     * Deletes dashboards from the 'default' folder where owner matches ZO_ROOT_USER_EMAIL
     */
    async cleanupDashboards() {
        testLogger.info('Starting dashboard cleanup', { owner: this.email });

        try {
            // Fetch dashboards from default folder
            const dashboards = await this.fetchDashboardsInFolder('default');
            testLogger.info('Fetched dashboards', { total: dashboards.length });

            // Filter dashboards owned by automation user
            const ownedDashboards = dashboards.filter(d => d.owner === this.email);
            testLogger.info('Found dashboards owned by automation user', { count: ownedDashboards.length });

            if (ownedDashboards.length === 0) {
                testLogger.info('No dashboards to clean up');
                return;
            }

            // Delete each dashboard
            let deletedCount = 0;
            let failedCount = 0;

            for (const dashboard of ownedDashboards) {
                const result = await this.deleteDashboard(dashboard.dashboard_id, dashboard.folder_id);

                if (result.code === 200) {
                    deletedCount++;
                    testLogger.debug('Deleted dashboard', {
                        id: dashboard.dashboard_id,
                        title: dashboard.title
                    });
                } else {
                    failedCount++;
                    testLogger.warn('Failed to delete dashboard', {
                        id: dashboard.dashboard_id,
                        title: dashboard.title,
                        result
                    });
                }
            }

            testLogger.info('Dashboard cleanup completed', {
                total: ownedDashboards.length,
                deleted: deletedCount,
                failed: failedCount
            });

        } catch (error) {
            testLogger.error('Dashboard cleanup failed', { error: error.message });
        }
    }

    /**
     * Complete cascade cleanup: Alert -> Folder -> Destination -> Template
     * Only deletes resources linked to destinations matching the prefix
     * @param {string} prefix - Prefix to match destination names (e.g., 'auto_playwright')
     */
    async completeCascadeCleanup(prefix = 'auto_playwright') {
        testLogger.info('Starting complete cascade cleanup', { prefix });

        try {
            // Step 1: Fetch all destinations and filter by prefix
            const { destinations, templateToDestinations } = await this.fetchDestinationsWithTemplateMapping();
            const matchingDestinations = destinations.filter(d => d.name.startsWith(prefix));

            testLogger.info('Found destinations to process', { total: matchingDestinations.length });

            if (matchingDestinations.length === 0) {
                testLogger.info('No destinations found matching prefix - cleanup not needed', { prefix });
                return;
            }

            const failedDestinations = [];
            const deletedDestinations = [];
            const linkedTemplates = new Set();

            // Step 2: Attempt to delete each destination
            for (const destination of matchingDestinations) {
                // Track template for potential cleanup
                if (destination.template) {
                    linkedTemplates.add(destination.template);
                }

                const deleteResult = await fetch(`${this.baseUrl}/api/${this.org}/alerts/destinations/${destination.name}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': this.authHeader,
                        'Content-Type': 'application/json'
                    }
                });

                const result = await deleteResult.json();

                if (result.code === 409 && result.message) {
                    // Extract alert name from error
                    const match = result.message.match(/alert:\s*(.+)$/);
                    const linkedAlert = match && match[1] ? match[1].trim() : null;

                    if (linkedAlert) {
                        failedDestinations.push({
                            destinationName: destination.name,
                            templateName: destination.template,
                            alertName: linkedAlert
                        });
                        testLogger.info('Destination blocked by alert', {
                            destination: destination.name,
                            alert: linkedAlert,
                            template: destination.template
                        });
                    }
                } else if (result.code === 200) {
                    deletedDestinations.push(destination.name);
                    testLogger.debug('Deleted destination successfully', { name: destination.name });
                }
            }

            testLogger.info('Initial destination deletion summary', {
                total: matchingDestinations.length,
                deleted: deletedDestinations.length,
                blocked: failedDestinations.length
            });

            // Step 3: Fetch all folders (only if there are failed destinations)
            let folders = [];
            if (failedDestinations.length > 0) {
                folders = await this.fetchAlertFolders();
                testLogger.info('Fetched alert folders', { total: folders.length });
            }

            // Step 4: Process each failed destination with cascade
            for (const failed of failedDestinations) {
                testLogger.info('Processing cascade cleanup', {
                    destination: failed.destinationName,
                    alert: failed.alertName,
                    template: failed.templateName
                });

                // Extract suffix from alert name (e.g., Automation_Alert_8OvH5 -> 8OvH5)
                const alertSuffix = failed.alertName.split('_').pop();
                const expectedFolderName = `auto_${alertSuffix}`;

                // Try to find matching folder by name first
                let folder = folders.find(f => f.name === expectedFolderName);
                let alerts = [];

                if (!folder) {
                    testLogger.warn('Could not find expected folder, searching all folders for alert', {
                        alert: failed.alertName,
                        expectedFolder: expectedFolderName
                    });

                    // Search testfoldermove first, then all other folders
                    const testFolderMove = folders.find(f => f.name === 'testfoldermove');
                    const otherFolders = folders.filter(f => f.name !== 'testfoldermove');
                    const searchOrder = testFolderMove ? [testFolderMove, ...otherFolders] : folders;

                    // Search through each folder to find the alert
                    for (const searchFolder of searchOrder) {
                        const alertsInFolder = await this.fetchAlertsInFolder(searchFolder.folderId);
                        const foundAlert = alertsInFolder.find(a => a.name === failed.alertName);

                        if (foundAlert) {
                            folder = searchFolder;
                            alerts = alertsInFolder;
                            testLogger.info('Found alert in folder', {
                                alert: failed.alertName,
                                folderId: folder.folderId,
                                folderName: folder.name
                            });
                            break;
                        }
                    }

                    if (!folder) {
                        testLogger.error('Could not find alert in any folder', {
                            alert: failed.alertName,
                            searchedFolders: folders.length
                        });
                        continue;
                    }
                } else {
                    testLogger.info('Found folder for alert', {
                        folderId: folder.folderId,
                        folderName: folder.name
                    });

                    // Step 5: Fetch alerts in folder
                    alerts = await this.fetchAlertsInFolder(folder.folderId);
                }

                testLogger.info('Alerts in folder', { count: alerts.length });

                // Step 6: Delete all alerts in folder
                for (const alert of alerts) {
                    const alertDeleteResult = await this.deleteAlert(alert.alert_id, folder.folderId);
                    if (alertDeleteResult.code === 200) {
                        testLogger.debug('Deleted alert', { alertId: alert.alert_id, name: alert.name });
                    } else {
                        testLogger.warn('Failed to delete alert', {
                            alertId: alert.alert_id,
                            name: alert.name,
                            result: alertDeleteResult
                        });
                    }
                }

                // Step 7: Delete folder
                const folderDeleteResult = await this.deleteFolder(folder.folderId);
                if (folderDeleteResult.code === 200) {
                    testLogger.info('Deleted folder', { folderId: folder.folderId, name: folder.name });
                } else {
                    testLogger.warn('Failed to delete folder', { folderId: folder.folderId, result: folderDeleteResult });
                }

                // Step 8: Delete destination (retry after alert removal)
                const destDeleteResult = await fetch(`${this.baseUrl}/api/${this.org}/alerts/destinations/${failed.destinationName}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': this.authHeader,
                        'Content-Type': 'application/json'
                    }
                });
                const destResult = await destDeleteResult.json();
                if (destResult.code === 200) {
                    testLogger.info('Deleted destination', { name: failed.destinationName });
                    deletedDestinations.push(failed.destinationName);
                } else {
                    testLogger.warn('Failed to delete destination', { name: failed.destinationName, result: destResult });
                }
            }

            // Step 9: Delete templates that were linked to deleted destinations
            testLogger.info('Cleaning up linked templates', { templates: Array.from(linkedTemplates) });

            for (const templateName of linkedTemplates) {
                const templateDeleteResult = await fetch(`${this.baseUrl}/api/${this.org}/alerts/templates/${templateName}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': this.authHeader,
                        'Content-Type': 'application/json'
                    }
                });
                const templateResult = await templateDeleteResult.json();
                if (templateResult.code === 200) {
                    testLogger.info('Deleted template', { name: templateName });
                } else {
                    testLogger.warn('Failed to delete template', {
                        name: templateName,
                        result: templateResult,
                        note: 'Template may still be in use by other destinations'
                    });
                }
            }

            // Step 10: Delete all remaining folders starting with 'auto_'
            testLogger.info('Cleaning up remaining folders starting with auto_');

            // Fetch fresh list of all folders
            const allFolders = await this.fetchAlertFolders();
            const autoFolders = allFolders.filter(f => f.name.startsWith('auto_'));
            testLogger.info('Found folders to clean up', { total: autoFolders.length });

            for (const folder of autoFolders) {
                // First, delete all alerts in the folder
                const alerts = await this.fetchAlertsInFolder(folder.folderId);

                if (alerts.length > 0) {
                    testLogger.info('Deleting alerts in folder before folder deletion', {
                        folderId: folder.folderId,
                        folderName: folder.name,
                        alertCount: alerts.length
                    });

                    for (const alert of alerts) {
                        const alertDeleteResult = await this.deleteAlert(alert.alert_id, folder.folderId);
                        if (alertDeleteResult.code === 200) {
                            testLogger.debug('Deleted alert', { alertId: alert.alert_id, name: alert.name });
                        } else {
                            testLogger.warn('Failed to delete alert', {
                                alertId: alert.alert_id,
                                name: alert.name,
                                result: alertDeleteResult
                            });
                        }
                    }
                }

                // Then delete the folder
                const folderDeleteResult = await this.deleteFolder(folder.folderId);

                // Handle both JSON and plain text responses
                if (folderDeleteResult.code === 200 || folderDeleteResult.message?.includes('Folder deleted')) {
                    testLogger.info('Deleted folder', { folderId: folder.folderId, name: folder.name });
                } else {
                    testLogger.warn('Failed to delete folder', {
                        folderId: folder.folderId,
                        name: folder.name,
                        result: folderDeleteResult
                    });
                }
            }

            testLogger.info('Complete cascade cleanup finished', {
                totalDestinations: matchingDestinations.length,
                deletedDestinations: deletedDestinations.length,
                linkedTemplates: linkedTemplates.size,
                foldersDeleted: autoFolders.length
            });

        } catch (error) {
            testLogger.error('Complete cascade cleanup failed', { error: error.message });
        }
    }
}

module.exports = APICleanup;
