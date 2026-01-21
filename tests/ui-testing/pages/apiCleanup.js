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
     * Fetch all pipelines
     * @returns {Promise<Array>} Array of pipeline objects
     */
    async fetchPipelines() {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/pipelines`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch pipelines', { status: response.status });
                return [];
            }

            const data = await response.json();
            return data.list || [];
        } catch (error) {
            testLogger.error('Failed to fetch pipelines', { error: error.message });
            return [];
        }
    }

    /**
     * Delete a single pipeline
     * @param {string} pipelineId - The pipeline ID
     * @returns {Promise<Object>} Deletion result
     */
    async deletePipeline(pipelineId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/pipelines/${pipelineId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to delete pipeline', { pipelineId, status: response.status });
                return { code: response.status, message: 'Failed to delete pipeline' };
            }

            const result = await response.json();
            return result;
        } catch (error) {
            testLogger.error('Failed to delete pipeline', { pipelineId, error: error.message });
            return { code: 500, error: error.message };
        }
    }

    /**
     * Fetch all functions in a specific organization
     * @param {string} org - The organization identifier (defaults to 'default')
     * @returns {Promise<Array>} Array of function objects
     */
    async fetchFunctionsInOrg(org = 'default') {
        try {
            const response = await fetch(`${this.baseUrl}/api/${org}/functions?page_num=1&page_size=100000&sort_by=name&desc=false&name=`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch functions', { org, status: response.status });
                return [];
            }

            const data = await response.json();
            return data.list || [];
        } catch (error) {
            testLogger.error('Failed to fetch functions', { org, error: error.message });
            return [];
        }
    }

    /**
     * Delete a single function in a specific organization
     * @param {string} org - The organization identifier
     * @param {string} functionName - The function name
     * @returns {Promise<Object>} Deletion result
     */
    async deleteFunctionInOrg(org, functionName) {
        try {
            const response = await fetch(`${this.baseUrl}/api/${org}/functions/${functionName}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to delete function', { org, functionName, status: response.status });
                return { code: response.status, message: 'Failed to delete function' };
            }

            const result = await response.json();
            return result;
        } catch (error) {
            testLogger.error('Failed to delete function', { org, functionName, error: error.message });
            return { code: 500, error: error.message };
        }
    }

    /**
     * Clean up functions matching patterns in a specific organization
     * @param {string} org - The organization identifier
     * @param {Array<RegExp>} patterns - Array of regex patterns to match function names
     */
    async cleanupFunctionsInOrg(org, patterns = []) {
        testLogger.info(`Starting functions cleanup in ${org} org`, { patterns: patterns.map(p => p.source) });

        try {
            // Fetch all functions in the specified org
            const functions = await this.fetchFunctionsInOrg(org);
            testLogger.info(`Fetched functions from ${org}`, { total: functions.length });

            // Filter functions matching patterns
            const matchingFunctions = functions.filter(f =>
                patterns.some(pattern => pattern.test(f.name))
            );
            testLogger.info(`Found functions matching cleanup patterns in ${org}`, { count: matchingFunctions.length });

            if (matchingFunctions.length === 0) {
                testLogger.info(`No functions to clean up in ${org}`);
                return;
            }

            // Delete each function
            let deletedCount = 0;
            let failedCount = 0;

            for (const func of matchingFunctions) {
                const result = await this.deleteFunctionInOrg(org, func.name);

                if (result.code === 200) {
                    deletedCount++;
                    testLogger.debug('Deleted function', { org, name: func.name });
                } else {
                    failedCount++;
                    testLogger.warn('Failed to delete function', { org, name: func.name, result });
                }
            }

            testLogger.info(`Functions cleanup completed in ${org}`, { deletedCount, failedCount });
        } catch (error) {
            testLogger.error(`Failed to cleanup functions in ${org}`, { error: error.message });
        }
    }

    /**
     * Fetch all enrichment tables
     * @returns {Promise<Array>} Array of enrichment table objects
     */
    async fetchEnrichmentTables() {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/streams?type=enrichment_tables`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch enrichment tables', { status: response.status });
                return [];
            }

            const data = await response.json();
            return data.list || [];
        } catch (error) {
            testLogger.error('Failed to fetch enrichment tables', { error: error.message });
            return [];
        }
    }

    /**
     * Delete a single enrichment table
     * @param {string} tableName - The enrichment table name
     * @returns {Promise<Object>} Deletion result
     */
    async deleteEnrichmentTable(tableName) {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/streams/${tableName}?type=enrichment_tables&delete_all=true`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to delete enrichment table', { tableName, status: response.status });
                return { code: response.status, message: 'Failed to delete enrichment table' };
            }

            const result = await response.json();
            return result;
        } catch (error) {
            testLogger.error('Failed to delete enrichment table', { tableName, error: error.message });
            return { code: 500, error: error.message };
        }
    }

    /**
     * Clean up enrichment tables matching specified patterns
     * @param {Array<RegExp>} patterns - Array of regex patterns to match table names
     */
    async cleanupEnrichmentTables(patterns = []) {
        testLogger.info('Starting enrichment tables cleanup', { patterns: patterns.map(p => p.source) });

        try {
            // Fetch all enrichment tables
            const tables = await this.fetchEnrichmentTables();
            testLogger.info('Fetched enrichment tables', { total: tables.length });

            // Filter tables matching patterns
            const matchingTables = tables.filter(t =>
                patterns.some(pattern => pattern.test(t.name))
            );
            testLogger.info('Found enrichment tables matching cleanup pattern', { count: matchingTables.length });

            if (matchingTables.length === 0) {
                testLogger.info('No enrichment tables to clean up');
                return;
            }

            // Delete each table
            let deletedCount = 0;
            let failedCount = 0;

            for (const table of matchingTables) {
                const result = await this.deleteEnrichmentTable(table.name);

                if (result.code === 200) {
                    deletedCount++;
                    testLogger.debug('Deleted enrichment table', { name: table.name });
                } else {
                    failedCount++;
                    testLogger.warn('Failed to delete enrichment table', { name: table.name, result });
                }
            }

            testLogger.info('Enrichment tables cleanup completed', {
                total: matchingTables.length,
                deleted: deletedCount,
                failed: failedCount
            });

        } catch (error) {
            testLogger.error('Enrichment tables cleanup failed', { error: error.message });
        }
    }

    /**
     * Clean up all pipelines for specific streams and matching patterns
     * Deletes pipelines where source.stream_name matches any of the target streams or patterns
     * @param {Array<string>} streamNames - Array of stream names to match
     * @param {Array<RegExp>} sourceStreamPatterns - Array of regex patterns to match source stream names
     * @param {Array<RegExp>} pipelineNamePatterns - Array of regex patterns to match pipeline names
     */
    async cleanupPipelines(streamNames = [], sourceStreamPatterns = [], pipelineNamePatterns = []) {
        testLogger.info('Starting pipeline cleanup', {
            streams: streamNames,
            sourceStreamPatterns: sourceStreamPatterns.map(p => p.toString()),
            pipelineNamePatterns: pipelineNamePatterns.map(p => p.toString())
        });

        try {
            // Fetch all pipelines
            const pipelines = await this.fetchPipelines();
            testLogger.info('Fetched pipelines', { total: pipelines.length });

            // Filter pipelines by source stream name OR by pattern matching
            const matchingPipelines = pipelines.filter(p => {
                if (!p.source) return false;

                // Exact match for stream names
                if (streamNames.length > 0 && streamNames.includes(p.source.stream_name)) return true;

                // Pattern match for source stream names
                if (sourceStreamPatterns.length > 0 && p.source.stream_name &&
                    sourceStreamPatterns.some(pattern => pattern.test(p.source.stream_name))) {
                    return true;
                }

                // Pattern match for pipeline names
                if (pipelineNamePatterns.length > 0 && p.name &&
                    pipelineNamePatterns.some(pattern => pattern.test(p.name))) {
                    return true;
                }

                return false;
            });
            testLogger.info('Found pipelines matching target streams', { count: matchingPipelines.length });

            if (matchingPipelines.length === 0) {
                testLogger.info('No pipelines to clean up');
                return;
            }

            // Delete each pipeline
            let deletedCount = 0;
            let failedCount = 0;

            for (const pipeline of matchingPipelines) {
                const result = await this.deletePipeline(pipeline.pipeline_id);

                if (result.code === 200) {
                    deletedCount++;
                    testLogger.debug('Deleted pipeline', {
                        id: pipeline.pipeline_id,
                        name: pipeline.name,
                        stream: pipeline.source.stream_name
                    });
                } else {
                    failedCount++;
                    testLogger.warn('Failed to delete pipeline', {
                        id: pipeline.pipeline_id,
                        name: pipeline.name,
                        stream: pipeline.source.stream_name,
                        result
                    });
                }
            }

            testLogger.info('Pipeline cleanup completed', {
                total: matchingPipelines.length,
                deleted: deletedCount,
                failed: failedCount
            });

        } catch (error) {
            testLogger.error('Pipeline cleanup failed', { error: error.message });
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
     * Fetch all log streams
     * @returns {Promise<Array>} Array of stream objects
     */
    async fetchStreams() {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/streams?type=logs`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch streams', { status: response.status });
                return [];
            }

            const data = await response.json();
            return data.list || [];
        } catch (error) {
            testLogger.error('Failed to fetch streams', { error: error.message });
            return [];
        }
    }

    /**
     * Delete a single stream
     * @param {string} streamName - The stream name
     * @returns {Promise<Object>} Deletion result
     */
    async deleteStream(streamName) {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/streams/${streamName}?type=logs&delete_all=true`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to delete stream', { streamName, status: response.status });
                return { code: response.status, message: 'Failed to delete stream' };
            }

            const result = await response.json();
            return result;
        } catch (error) {
            testLogger.error('Failed to delete stream', { streamName, error: error.message });
            return { code: 500, error: error.message };
        }
    }

    /**
     * Check if a stream is still being deleted or exists
     * Two-phase check:
     * 1. GET stream settings - checks if schema exists
     * 2. If schema gone, PUT settings to check if deletion marker is still active
     * @param {string} streamName - The stream name to check
     * @returns {Promise<boolean>} True if stream still exists or is being deleted
     */
    async isStreamStillDeleting(streamName) {
        try {
            // Phase 1: Check if stream schema exists via GET
            const getResponse = await fetch(
                `${this.baseUrl}/api/${this.org}/streams/${streamName}/settings?type=logs`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': this.authHeader,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // If we get 200, stream still exists
            if (getResponse.ok) {
                testLogger.debug('Stream schema still exists', { streamName });
                return true;
            }

            // Check GET response for "is being deleted" error
            const getResult = await getResponse.json().catch(() => ({}));
            if (getResult.message && getResult.message.includes('is being deleted')) {
                testLogger.debug('Stream is being deleted (GET check)', { streamName });
                return true;
            }

            // Phase 2: Schema is gone (404), but deletion marker might still be active
            // Try PUT settings - this triggers is_deleting_stream check without creating data
            const putResponse = await fetch(
                `${this.baseUrl}/api/${this.org}/streams/${streamName}/settings?type=logs`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': this.authHeader,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({})  // Empty settings - won't create anything
                }
            );

            const putResult = await putResponse.json().catch(() => ({}));

            // Check if deletion marker is still active
            if (putResult.message && putResult.message.includes('is being deleted')) {
                testLogger.debug('Stream deletion marker still active (PUT check)', { streamName });
                return true;
            }

            // Both schema gone and no deletion marker - deletion complete
            testLogger.debug('Stream deletion fully complete', { streamName, getStatus: getResponse.status, putStatus: putResponse.status });
            return false;
        } catch (error) {
            // Network error - assume deletion might still be in progress
            testLogger.warn('Error checking stream deletion status', { streamName, error: error.message });
            return true;
        }
    }

    /**
     * Wait for a stream deletion to fully complete
     * @param {string} streamName - The stream name to wait for
     * @param {number} maxWaitMs - Maximum time to wait in milliseconds (default: 120000 = 2 minutes)
     * @param {number} pollIntervalMs - Polling interval in milliseconds (default: 3000 = 3 seconds)
     * @returns {Promise<boolean>} True if deletion completed, false if timed out
     */
    async waitForStreamDeletion(streamName, maxWaitMs = 120000, pollIntervalMs = 3000) {
        const startTime = Date.now();
        let attempts = 0;

        while (Date.now() - startTime < maxWaitMs) {
            attempts++;
            const stillDeleting = await this.isStreamStillDeleting(streamName);

            if (!stillDeleting) {
                testLogger.debug('Stream deletion confirmed complete', {
                    streamName,
                    attempts,
                    elapsedMs: Date.now() - startTime
                });
                return true;
            }

            testLogger.debug('Stream still being deleted, waiting...', {
                streamName,
                attempts,
                elapsedMs: Date.now() - startTime
            });

            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }

        testLogger.warn('Timeout waiting for stream deletion', {
            streamName,
            maxWaitMs,
            attempts
        });
        return false;
    }

    /**
     * Wait for specific stream names to be ready (not in "being deleted" state)
     * Use this to ensure streams are available before tests, even if they weren't found in the stream list
     * @param {Array<string>} streamNames - Array of stream names to check
     * @param {number} maxWaitMs - Maximum time to wait per stream in ms (default: 120000)
     * @returns {Promise<{ready: number, blocked: string[]}>} Count of ready streams and list of blocked stream names
     */
    async waitForStreamsReady(streamNames = [], maxWaitMs = 120000) {
        testLogger.info('Waiting for streams to be ready (not being deleted)...', {
            streamCount: streamNames.length,
            maxWaitMs
        });

        let readyCount = 0;
        const blockedStreams = [];

        // Process in parallel batches
        const batchSize = 5;
        for (let i = 0; i < streamNames.length; i += batchSize) {
            const batch = streamNames.slice(i, i + batchSize);
            const results = await Promise.all(
                batch.map(async (streamName) => {
                    const ready = await this.waitForStreamDeletion(streamName, maxWaitMs);
                    return { streamName, ready };
                })
            );

            results.forEach(({ streamName, ready }) => {
                if (ready) {
                    readyCount++;
                } else {
                    blockedStreams.push(streamName);
                    testLogger.error('Stream still blocked (being deleted)', { streamName });
                }
            });
        }

        testLogger.info('Streams ready check complete', {
            total: streamNames.length,
            ready: readyCount,
            blocked: blockedStreams.length,
            blockedNames: blockedStreams
        });

        if (blockedStreams.length > 0) {
            throw new Error(`${blockedStreams.length} stream(s) still being deleted: ${blockedStreams.join(', ')}`);
        }

        return { ready: readyCount, blocked: blockedStreams };
    }

    /**
     * Fetch all metrics streams
     * @returns {Promise<Array>} Array of metrics stream objects
     */
    async fetchMetricsStreams() {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/streams?type=metrics`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch metrics streams', { status: response.status });
                return [];
            }

            const data = await response.json();
            return data.list || [];
        } catch (error) {
            testLogger.error('Failed to fetch metrics streams', { error: error.message });
            return [];
        }
    }

    /**
     * Delete a single metrics stream
     * @param {string} streamName - The metrics stream name
     * @returns {Promise<Object>} Deletion result
     */
    async deleteMetricsStream(streamName) {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/streams/${streamName}?type=metrics&delete_all=true`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to delete metrics stream', { streamName, status: response.status });
                return { code: response.status, message: 'Failed to delete metrics stream' };
            }

            const result = await response.json();
            // Ensure success response has code: 200 for consistency
            return { code: 200, ...result };
        } catch (error) {
            testLogger.error('Failed to delete metrics stream', { streamName, error: error.message });
            return { code: 500, message: error.message };
        }
    }

    /**
     * Clean up metrics streams matching specified patterns
     * @param {Array<RegExp>} patterns - Array of regex patterns to match metrics stream names
     * @param {Array<string>} protectedStreams - Array of metrics stream names to never delete (optional, e.g., 'default')
     */
    async cleanupMetricsStreams(patterns = [], protectedStreams = ['default']) {
        testLogger.info('Starting metrics streams cleanup', {
            patterns: patterns.map(p => p.source),
            protectedStreams
        });

        // Safety check: If no patterns provided, don't delete anything
        if (patterns.length === 0) {
            testLogger.info('No patterns provided for metrics cleanup - skipping');
            return;
        }

        try {
            // Fetch all metrics streams
            const streams = await this.fetchMetricsStreams();
            testLogger.info('Fetched metrics streams', { total: streams.length });

            // Filter streams matching patterns but excluding protected streams
            const matchingStreams = streams.filter(s =>
                patterns.some(pattern => pattern.test(s.name)) &&
                !protectedStreams.includes(s.name)
            );
            testLogger.info('Found metrics streams matching cleanup patterns', { count: matchingStreams.length });

            if (matchingStreams.length === 0) {
                testLogger.info('No metrics streams to clean up');
                return;
            }

            // Delete all matching metrics streams
            let deletedCount = 0;
            let failedCount = 0;

            for (const stream of matchingStreams) {
                const result = await this.deleteMetricsStream(stream.name);

                if (result.code === 200) {
                    deletedCount++;
                    testLogger.info('Deleted metrics stream', { name: stream.name });
                } else {
                    failedCount++;
                    testLogger.warn('Failed to delete metrics stream', { name: stream.name, result });
                }
            }

            testLogger.info('Metrics streams cleanup completed', {
                total: matchingStreams.length,
                deleted: deletedCount,
                failed: failedCount
            });

        } catch (error) {
            testLogger.error('Metrics streams cleanup failed', { error: error.message });
        }
    }

    /**
     * Clean up streams matching specified patterns
     * @param {Array<RegExp>} patterns - Array of regex patterns to match stream names
     * @param {Array<string>} protectedStreams - Array of stream names to never delete (optional)
     * @param {Object} options - Optional configuration
     * @param {boolean} options.waitForDeletion - Whether to wait for deletions to complete (default: true)
     * @param {number} options.maxWaitPerStreamMs - Max wait time per stream in ms (default: 120000)
     */
    async cleanupStreams(patterns = [], protectedStreams = [], options = {}) {
        const { waitForDeletion = true, maxWaitPerStreamMs = 120000 } = options;

        testLogger.info('Starting streams cleanup', {
            patterns: patterns.map(p => p.source),
            protectedStreams,
            waitForDeletion
        });

        try {
            // Fetch all log streams
            const streams = await this.fetchStreams();
            testLogger.info('Fetched streams', { total: streams.length });

            // Filter streams matching patterns but excluding protected streams
            const matchingStreams = streams.filter(s =>
                patterns.some(pattern => pattern.test(s.name)) &&
                !protectedStreams.includes(s.name)
            );
            testLogger.info('Found streams matching cleanup patterns', { count: matchingStreams.length });

            if (matchingStreams.length === 0) {
                testLogger.info('No streams to clean up');
                return;
            }

            // Phase 1: Initiate deletion for all streams
            let deletedCount = 0;
            let failedCount = 0;
            const streamsToWaitFor = [];

            for (const stream of matchingStreams) {
                const result = await this.deleteStream(stream.name);

                if (result.code === 200) {
                    deletedCount++;
                    streamsToWaitFor.push(stream.name);
                    testLogger.debug('Initiated stream deletion', { name: stream.name });
                } else {
                    failedCount++;
                    testLogger.warn('Failed to initiate stream deletion', { name: stream.name, result });
                }
            }

            testLogger.info('Stream deletion initiated', {
                total: matchingStreams.length,
                initiated: deletedCount,
                failed: failedCount
            });

            // Phase 2: Wait for all deletions to complete (if enabled)
            if (waitForDeletion && streamsToWaitFor.length > 0) {
                testLogger.info('Waiting for stream deletions to complete...', {
                    streamCount: streamsToWaitFor.length,
                    maxWaitPerStreamMs
                });

                let completedCount = 0;
                let timedOutCount = 0;

                // Wait for streams in parallel batches to speed up the process
                const batchSize = 5;
                for (let i = 0; i < streamsToWaitFor.length; i += batchSize) {
                    const batch = streamsToWaitFor.slice(i, i + batchSize);
                    const results = await Promise.all(
                        batch.map(streamName => this.waitForStreamDeletion(streamName, maxWaitPerStreamMs))
                    );

                    results.forEach((completed, index) => {
                        if (completed) {
                            completedCount++;
                        } else {
                            timedOutCount++;
                            testLogger.error('Stream deletion timed out', { streamName: batch[index] });
                        }
                    });
                }

                testLogger.info('Stream deletion verification complete', {
                    total: streamsToWaitFor.length,
                    completed: completedCount,
                    timedOut: timedOutCount
                });

                if (timedOutCount > 0) {
                    throw new Error(`${timedOutCount} stream(s) failed to complete deletion within timeout`);
                }
            }

            testLogger.info('Streams cleanup completed successfully', {
                total: matchingStreams.length,
                deleted: deletedCount,
                failed: failedCount
            });

        } catch (error) {
            testLogger.error('Streams cleanup failed', { error: error.message });
            throw error; // Re-throw to fail the cleanup test
        }
    }

    /**
     * Fetch all pipeline destinations
     * @returns {Promise<Array>} Array of pipeline destination objects
     */
    async fetchPipelineDestinations() {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/alerts/destinations?page_num=1&page_size=100000&sort_by=name&desc=false&module=pipeline`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch pipeline destinations', { status: response.status });
                return [];
            }

            const destinations = await response.json();
            return destinations;
        } catch (error) {
            testLogger.error('Failed to fetch pipeline destinations', { error: error.message });
            return [];
        }
    }

    /**
     * Delete a pipeline destination
     * @param {string} name - Name of the destination to delete
     * @returns {Promise<Object>} Delete result with code and message
     */
    async deletePipelineDestination(name) {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/alerts/destinations/${name}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            const result = await response.json();
            return { code: response.status, ...result };
        } catch (error) {
            testLogger.error('Failed to delete pipeline destination', { name, error: error.message });
            return { code: 500, message: error.message };
        }
    }

    /**
     * Clean up pipeline destinations matching specified patterns
     * @param {Array<RegExp>} patterns - Array of regex patterns to match destination names
     */
    async cleanupPipelineDestinations(patterns = []) {
        testLogger.info('Starting pipeline destinations cleanup', { patterns: patterns.map(p => p.source) });

        try {
            // Fetch all pipeline destinations
            const destinations = await this.fetchPipelineDestinations();
            testLogger.info('Fetched pipeline destinations', { total: destinations.length });

            // Filter destinations matching patterns
            const matchingDestinations = destinations.filter(d =>
                patterns.some(pattern => pattern.test(d.name))
            );
            testLogger.info('Found pipeline destinations matching cleanup pattern', { count: matchingDestinations.length });

            if (matchingDestinations.length === 0) {
                testLogger.info('No pipeline destinations to clean up');
                return;
            }

            // Delete each destination
            let deletedCount = 0;
            let failedCount = 0;

            for (const destination of matchingDestinations) {
                const result = await this.deletePipelineDestination(destination.name);

                if (result.code === 200) {
                    deletedCount++;
                    testLogger.debug('Deleted pipeline destination', { name: destination.name });
                } else {
                    failedCount++;
                    testLogger.warn('Failed to delete pipeline destination', { name: destination.name, result });
                }
            }

            testLogger.info('Pipeline destinations cleanup completed', {
                total: matchingDestinations.length,
                deleted: deletedCount,
                failed: failedCount
            });

        } catch (error) {
            testLogger.error('Pipeline destinations cleanup failed', { error: error.message });
        }
    }

    /**
     * Fetch all service accounts
     * @returns {Promise<Array>} Array of service account objects
     */
    async fetchServiceAccounts() {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/service_accounts`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch service accounts', { status: response.status });
                return [];
            }

            const data = await response.json();
            return data.data || [];
        } catch (error) {
            testLogger.error('Failed to fetch service accounts', { error: error.message });
            return [];
        }
    }

    /**
     * Delete a single service account
     * @param {string} email - The service account email
     * @returns {Promise<Object>} Deletion result
     */
    async deleteServiceAccount(email) {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/service_accounts/${email}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to delete service account', { email, status: response.status });
                return { code: response.status, message: 'Failed to delete service account' };
            }

            const result = await response.json();
            return result;
        } catch (error) {
            testLogger.error('Failed to delete service account', { email, error: error.message });
            return { code: 500, error: error.message };
        }
    }

    /**
     * Clean up all service accounts matching pattern "email*@gmail.com"
     * Deletes service accounts with emails starting with "email" and ending with "@gmail.com"
     */
    async cleanupServiceAccounts() {
        testLogger.info('Starting service accounts cleanup');

        try {
            // Fetch all service accounts
            const serviceAccounts = await this.fetchServiceAccounts();
            testLogger.info('Fetched service accounts', { total: serviceAccounts.length });

            // Filter service accounts matching pattern: starts with "email" and ends with "@gmail.com"
            const pattern = /^email.*@gmail\.com$/;
            const matchingAccounts = serviceAccounts.filter(sa => pattern.test(sa.email));
            testLogger.info('Found service accounts matching cleanup pattern', { count: matchingAccounts.length });

            if (matchingAccounts.length === 0) {
                testLogger.info('No service accounts to clean up');
                return;
            }

            // Delete each service account
            let deletedCount = 0;
            let failedCount = 0;

            for (const account of matchingAccounts) {
                const result = await this.deleteServiceAccount(account.email);

                if (result.code === 200) {
                    deletedCount++;
                    testLogger.debug('Deleted service account', { email: account.email });
                } else {
                    failedCount++;
                    testLogger.warn('Failed to delete service account', { email: account.email, result });
                }
            }

            testLogger.info('Service accounts cleanup completed', {
                total: matchingAccounts.length,
                deleted: deletedCount,
                failed: failedCount
            });

        } catch (error) {
            testLogger.error('Service accounts cleanup failed', { error: error.message });
        }
    }

    /**
     * Fetch all users
     * @returns {Promise<Array>} Array of user objects
     */
    async fetchUsers() {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/users`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch users', { status: response.status });
                return [];
            }

            const data = await response.json();
            return data.data || [];
        } catch (error) {
            testLogger.error('Failed to fetch users', { error: error.message });
            return [];
        }
    }

    /**
     * Delete a single user
     * @param {string} email - The user email
     * @returns {Promise<Object>} Deletion result
     */
    async deleteUser(email) {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/users/${email}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to delete user', { email, status: response.status });
                return { code: response.status, message: 'Failed to delete user' };
            }

            const result = await response.json();
            return result;
        } catch (error) {
            testLogger.error('Failed to delete user', { email, error: error.message });
            return { code: 500, error: error.message };
        }
    }

    /**
     * Clean up all users matching patterns "email*@gmail.com" and "duplicate*@gmail.com"
     * Deletes users with emails starting with "email" or "duplicate" and ending with "@gmail.com"
     */
    async cleanupUsers() {
        testLogger.info('Starting users cleanup');

        try {
            // Fetch all users
            const users = await this.fetchUsers();
            testLogger.info('Fetched users', { total: users.length });

            // Filter users matching patterns: starts with "email" or "duplicate" and ends with "@gmail.com"
            const emailPattern = /^email.*@gmail\.com$/;
            const duplicatePattern = /^duplicate.*@gmail\.com$/;
            const matchingUsers = users.filter(user =>
                emailPattern.test(user.email) || duplicatePattern.test(user.email)
            );
            testLogger.info('Found users matching cleanup patterns', { count: matchingUsers.length });

            if (matchingUsers.length === 0) {
                testLogger.info('No users to clean up');
                return;
            }

            // Delete each user
            let deletedCount = 0;
            let failedCount = 0;

            for (const user of matchingUsers) {
                const result = await this.deleteUser(user.email);

                if (result.code === 200) {
                    deletedCount++;
                    testLogger.debug('Deleted user', { email: user.email });
                } else {
                    failedCount++;
                    testLogger.warn('Failed to delete user', { email: user.email, result });
                }
            }

            testLogger.info('Users cleanup completed', {
                total: matchingUsers.length,
                deleted: deletedCount,
                failed: failedCount
            });

        } catch (error) {
            testLogger.error('Users cleanup failed', { error: error.message });
        }
    }

    /**
     * Clean up regex patterns that match test data
     * Deletes patterns whose names appear in test data files:
     * - tests/test-data/regex_patterns_import.json
     * - tests/test-data/sdr_test_data.json
     */
    async cleanupRegexPatterns() {
        testLogger.info('Starting regex patterns cleanup');

        try {
            // Fetch all regex patterns
            const response = await fetch(`${this.baseUrl}/api/${this.org}/re_patterns`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            // Handle 404 or other errors gracefully (feature may not be available in OSS)
            if (!response.ok) {
                if (response.status === 404) {
                    testLogger.info('Regex patterns endpoint not available (OSS edition or feature not enabled)');
                } else {
                    testLogger.warn('Failed to fetch regex patterns', { status: response.status });
                }
                return;
            }

            const data = await response.json();
            const patterns = data.patterns || [];
            testLogger.info('Fetched regex patterns', { total: patterns.length });

            if (patterns.length === 0) {
                testLogger.info('No regex patterns found');
                return;
            }

            // Load test data pattern names
            const regexPatternsImport = require('../../test-data/regex_patterns_import.json');
            const sdrTestData = require('../../test-data/sdr_test_data.json');

            // Collect all pattern names from test data
            const testPatternNames = new Set();

            // From regex_patterns_import.json
            regexPatternsImport.forEach(pattern => {
                testPatternNames.add(pattern.name);
            });

            // From sdr_test_data.json
            if (sdrTestData.regexPatterns) {
                sdrTestData.regexPatterns.forEach(pattern => {
                    testPatternNames.add(pattern.name);
                });
            }

            testLogger.info('Loaded test pattern names', { count: testPatternNames.size });

            // Additional test prefixes that should always be cleaned up
            const testPrefixes = [
                'duplicate_test_',      // regexPatternManagement.spec.js
                'log_filename_',        // multipleSDRPatterns.spec.js
                'time_hh_mm_ss_',       // multipleSDRPatterns.spec.js
                'ifsc_code_',           // multipleSDRPatterns.spec.js
                'date_dd_mm_yyyy_',     // multipleSDRPatterns.spec.js
                'email_format_',        // SDR tests
                'us_phone_',            // SDR tests
                'credit_card_',         // SDR tests
                'ssn_'                  // SDR tests
            ];

            // Filter patterns that match test data names (using prefix matching to catch patterns with unique suffixes)
            const basePatternNames = Array.from(testPatternNames);
            const matchingPatterns = patterns.filter(pattern =>
                basePatternNames.some(baseName => pattern.name.startsWith(baseName)) ||
                testPrefixes.some(prefix => pattern.name.startsWith(prefix))
            );
            testLogger.info('Found patterns matching test data (prefix match)', { count: matchingPatterns.length });

            if (matchingPatterns.length === 0) {
                testLogger.info('No regex patterns to clean up');
                return;
            }

            // Delete each matching pattern
            let deletedCount = 0;
            let failedCount = 0;

            for (const pattern of matchingPatterns) {
                try {
                    const deleteResponse = await fetch(`${this.baseUrl}/api/${this.org}/re_patterns/${pattern.id}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': this.authHeader,
                            'Content-Type': 'application/json'
                        }
                    });

                    if (deleteResponse.ok) {
                        deletedCount++;
                        testLogger.debug('Deleted regex pattern', { name: pattern.name, id: pattern.id });
                    } else {
                        failedCount++;
                        testLogger.warn('Failed to delete regex pattern', {
                            name: pattern.name,
                            id: pattern.id,
                            status: deleteResponse.status
                        });
                    }
                } catch (error) {
                    failedCount++;
                    testLogger.error('Error deleting regex pattern', {
                        name: pattern.name,
                        id: pattern.id,
                        error: error.message
                    });
                }
            }

            testLogger.info('Regex patterns cleanup completed', {
                total: matchingPatterns.length,
                deleted: deletedCount,
                failed: failedCount
            });

        } catch (error) {
            testLogger.error('Regex patterns cleanup failed', { error: error.message });
        }
    }

    /**
     * Clean up custom logo from _meta organization
     * Deletes the custom logo via DELETE API call
     */
    async cleanupLogo() {
        testLogger.info('Starting logo cleanup');

        try {
            const response = await fetch(`${this.baseUrl}/api/_meta/settings/logo`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to delete logo', { status: response.status });
                return { successful: 'false', status: response.status };
            }

            const result = await response.json();

            if (result.successful === 'true') {
                testLogger.info('Logo cleanup completed successfully');
            } else {
                testLogger.warn('Logo cleanup returned unexpected result', { result });
            }

            return result;
        } catch (error) {
            testLogger.error('Logo cleanup failed', { error: error.message });
            return { successful: 'false', error: error.message };
        }
    }

    /**
     * Fetch all search jobs
     * @returns {Promise<Array>} Array of search job objects
     */
    async fetchSearchJobs() {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/search_jobs?type=logs`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch search jobs', { status: response.status });
                return [];
            }

            const searchJobs = await response.json();
            return searchJobs || [];
        } catch (error) {
            testLogger.error('Failed to fetch search jobs', { error: error.message });
            return [];
        }
    }

    /**
     * Delete a single search job
     * @param {string} jobId - The search job ID
     * @returns {Promise<Object>} Deletion result
     */
    async deleteSearchJob(jobId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/search_jobs/${jobId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to delete search job', { jobId, status: response.status });
                return { code: response.status, message: 'Failed to delete search job' };
            }

            const result = await response.json();
            return { code: 200, ...result };
        } catch (error) {
            testLogger.error('Failed to delete search job', { jobId, error: error.message });
            return { code: 500, error: error.message };
        }
    }

    /**
     * Clean up all search jobs
     * Deletes all search jobs for the organization
     */
    async cleanupSearchJobs() {
        testLogger.info('Starting search jobs cleanup');

        try {
            // Fetch all search jobs
            const searchJobs = await this.fetchSearchJobs();
            testLogger.info('Fetched search jobs', { total: searchJobs.length });

            if (searchJobs.length === 0) {
                testLogger.info('No search jobs to clean up');
                return;
            }

            // Delete each search job
            let deletedCount = 0;
            let failedCount = 0;

            for (const job of searchJobs) {
                const result = await this.deleteSearchJob(job.id);

                if (result.code === 200) {
                    deletedCount++;
                    testLogger.debug('Deleted search job', { jobId: job.id, userId: job.user_id });
                } else {
                    failedCount++;
                    testLogger.warn('Failed to delete search job', { jobId: job.id, userId: job.user_id, result });
                }
            }

            testLogger.info('Search jobs cleanup completed', {
                total: searchJobs.length,
                deleted: deletedCount,
                failed: failedCount
            });

        } catch (error) {
            testLogger.error('Search jobs cleanup failed', { error: error.message });
        }
    }

    /**
     * Fetch all saved views
     * @returns {Promise<Array>} Array of saved view objects
     */
    async fetchSavedViews() {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/savedviews`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to fetch saved views', { status: response.status });
                return [];
            }

            const data = await response.json();
            return data.views || [];
        } catch (error) {
            testLogger.error('Failed to fetch saved views', { error: error.message });
            return [];
        }
    }

    /**
     * Delete a single saved view
     * @param {string} viewId - The saved view ID
     * @returns {Promise<Object>} Deletion result
     */
    async deleteSavedView(viewId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/savedviews/${viewId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to delete saved view', { viewId, status: response.status });
                return { code: response.status, message: 'Failed to delete saved view' };
            }

            const result = await response.json();
            return { code: 200, ...result };
        } catch (error) {
            testLogger.error('Failed to delete saved view', { viewId, error: error.message });
            return { code: 500, error: error.message };
        }
    }

    /**
     * Clean up all saved views matching test patterns
     * Deletes saved views starting with "streamslog" or "multistream_view_"
     */
    async cleanupSavedViews() {
        testLogger.info('Starting saved views cleanup');

        try {
            // Fetch all saved views
            const savedViews = await this.fetchSavedViews();
            testLogger.info('Fetched saved views', { total: savedViews.length });

            // Filter saved views matching patterns: starts with "streamslog" or "multistream_view_"
            const matchingSavedViews = savedViews.filter(view =>
                view.view_name.startsWith('streamslog') ||
                view.view_name.startsWith('multistream_view_')
            );
            testLogger.info('Found saved views matching cleanup patterns', { count: matchingSavedViews.length });

            if (matchingSavedViews.length === 0) {
                testLogger.info('No saved views to clean up');
                return;
            }

            // Delete each saved view
            let deletedCount = 0;
            let failedCount = 0;

            for (const view of matchingSavedViews) {
                const result = await this.deleteSavedView(view.view_id);

                if (result.code === 200) {
                    deletedCount++;
                    testLogger.debug('Deleted saved view', { viewId: view.view_id, viewName: view.view_name });
                } else {
                    failedCount++;
                    testLogger.warn('Failed to delete saved view', { viewId: view.view_id, viewName: view.view_name, result });
                }
            }

            testLogger.info('Saved views cleanup completed', {
                total: matchingSavedViews.length,
                deleted: deletedCount,
                failed: failedCount
            });

        } catch (error) {
            testLogger.error('Saved views cleanup failed', { error: error.message });
        }
    }

    /**
     * Complete cascade cleanup: Alerts -> Folders -> Destinations -> Templates
     * Deletes resources in correct dependency order to avoid conflicts
     * @param {Array<string|RegExp>} destinationPrefixes - Array of destination name prefixes or regex patterns to match (e.g., ['auto_', /^destination\d{1,3}$/])
     * @param {Array<string>} templatePrefixes - Array of template name prefixes to match (e.g., ['auto_email_template_', 'auto_webhook_template_'])
     * @param {Array<string>} folderPrefixes - Array of folder name prefixes to match (e.g., ['auto_'])
     */
    async completeCascadeCleanup(destinationPrefixes = [], templatePrefixes = [], folderPrefixes = []) {
        testLogger.info('Starting complete cascade cleanup (Alerts -> Folders -> Destinations -> Templates)', {
            destinationPrefixes,
            templatePrefixes,
            folderPrefixes
        });

        // Alert name prefixes to match - alerts with these prefixes will be deleted from ANY folder
        // This is derived from destination prefixes since alerts typically use similar naming
        const alertPrefixes = [
            'auto_',
            'Automation_',
            'sanity',
            'rbac_'
        ];

        try {
            // ============================================
            // STEP 1: Delete all ALERTS matching prefixes from ALL folders
            // (Alerts depend on destinations, so delete first)
            // ============================================
            let deletedAlerts = 0;
            let deletedFolders = 0;

            testLogger.info('Step 1: Deleting alerts matching prefixes from ALL folders', { alertPrefixes });

            const allFolders = await this.fetchAlertFolders();
            testLogger.info('Fetched all alert folders', { total: allFolders.length });

            for (const folder of allFolders) {
                // Fetch all alerts in this folder
                const alerts = await this.fetchAlertsInFolder(folder.folderId);

                if (alerts.length === 0) continue;

                // Filter alerts matching our prefixes
                const matchingAlerts = alerts.filter(alert =>
                    alertPrefixes.some(prefix => alert.name.startsWith(prefix))
                );

                if (matchingAlerts.length > 0) {
                    testLogger.info('Found matching alerts in folder', {
                        folderId: folder.folderId,
                        folderName: folder.name,
                        totalAlerts: alerts.length,
                        matchingAlerts: matchingAlerts.length
                    });

                    for (const alert of matchingAlerts) {
                        const alertDeleteResult = await this.deleteAlert(alert.alert_id, folder.folderId);
                        if (alertDeleteResult.code === 200) {
                            deletedAlerts++;
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
            }

            // ============================================
            // STEP 2: Delete FOLDERS matching prefixes (after alerts are gone)
            // ============================================
            if (folderPrefixes.length > 0) {
                testLogger.info('Step 2: Deleting folders matching prefixes', { prefixes: folderPrefixes });

                // Re-fetch folders to get current state
                const currentFolders = await this.fetchAlertFolders();
                const matchingFolders = currentFolders.filter(f =>
                    folderPrefixes.some(prefix => f.name.startsWith(prefix))
                );
                testLogger.info('Found folders matching prefixes', { total: matchingFolders.length });

                for (const folder of matchingFolders) {
                    // Delete any remaining alerts in the folder first
                    const remainingAlerts = await this.fetchAlertsInFolder(folder.folderId);
                    for (const alert of remainingAlerts) {
                        await this.deleteAlert(alert.alert_id, folder.folderId);
                        deletedAlerts++;
                    }

                    // Then delete the folder
                    const folderDeleteResult = await this.deleteFolder(folder.folderId);

                    if (folderDeleteResult.code === 200 || folderDeleteResult.message?.includes('Folder deleted')) {
                        deletedFolders++;
                        testLogger.info('Deleted folder', { folderId: folder.folderId, name: folder.name });
                    } else {
                        testLogger.warn('Failed to delete folder', {
                            folderId: folder.folderId,
                            name: folder.name,
                            result: folderDeleteResult
                        });
                    }
                }
            }

            testLogger.info('Step 1-2 complete: Alerts and folders deleted', {
                deletedAlerts,
                deletedFolders
            });

            // ============================================
            // STEP 3: Delete DESTINATIONS matching prefixes
            // (Destinations depend on templates, delete before templates)
            // ============================================
            let deletedDestinations = 0;

            if (destinationPrefixes.length > 0) {
                testLogger.info('Step 3: Deleting destinations matching prefixes/patterns', { prefixes: destinationPrefixes });

                const { destinations } = await this.fetchDestinationsWithTemplateMapping();
                const matchingDestinations = destinations.filter(d =>
                    destinationPrefixes.some(prefix => {
                        if (prefix instanceof RegExp) {
                            return prefix.test(d.name);
                        }
                        return d.name.startsWith(prefix);
                    })
                );
                testLogger.info('Found destinations matching prefixes/patterns', { total: matchingDestinations.length });

                for (const destination of matchingDestinations) {
                    const deleteResult = await fetch(`${this.baseUrl}/api/${this.org}/alerts/destinations/${destination.name}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': this.authHeader,
                            'Content-Type': 'application/json'
                        }
                    });

                    const result = await deleteResult.json();

                    if (result.code === 200) {
                        deletedDestinations++;
                        testLogger.debug('Deleted destination', { name: destination.name });
                    } else if (result.code === 409) {
                        // Destination still blocked by an alert - this shouldn't happen if alerts were deleted correctly
                        testLogger.warn('Destination still blocked by alert (unexpected)', {
                            name: destination.name,
                            result: result
                        });
                    } else {
                        testLogger.warn('Failed to delete destination', {
                            name: destination.name,
                            result: result
                        });
                    }
                }
            }

            testLogger.info('Step 3 complete: Destinations deleted', { deletedDestinations });

            // ============================================
            // STEP 4: Delete TEMPLATES matching prefixes
            // (Templates have no dependencies, delete last)
            // ============================================
            let deletedTemplates = 0;

            if (templatePrefixes.length > 0) {
                testLogger.info('Step 4: Deleting templates matching prefixes', { prefixes: templatePrefixes });

                const allTemplatesResponse = await fetch(`${this.baseUrl}/api/${this.org}/alerts/templates?page_num=1&page_size=100000&sort_by=name&desc=false`, {
                    method: 'GET',
                    headers: {
                        'Authorization': this.authHeader,
                        'Content-Type': 'application/json'
                    }
                });

                if (allTemplatesResponse.ok) {
                    const allTemplates = await allTemplatesResponse.json();
                    const matchingTemplates = allTemplates.filter(t =>
                        templatePrefixes.some(prefix => t.name.startsWith(prefix))
                    );
                    testLogger.info('Found templates matching prefixes', { total: matchingTemplates.length });

                    for (const template of matchingTemplates) {
                        const templateDeleteResult = await fetch(`${this.baseUrl}/api/${this.org}/alerts/templates/${template.name}`, {
                            method: 'DELETE',
                            headers: {
                                'Authorization': this.authHeader,
                                'Content-Type': 'application/json'
                            }
                        });
                        const templateResult = await templateDeleteResult.json();

                        if (templateResult.code === 200) {
                            deletedTemplates++;
                            testLogger.debug('Deleted template', { name: template.name });
                        } else if (templateResult.code === 409) {
                            // Template still in use by a destination - this shouldn't happen if destinations were deleted
                            testLogger.warn('Template still in use (unexpected)', {
                                name: template.name,
                                result: templateResult
                            });
                        } else {
                            testLogger.warn('Failed to delete template', {
                                name: template.name,
                                result: templateResult
                            });
                        }
                    }
                }
            }

            testLogger.info('Step 4 complete: Templates deleted', { deletedTemplates });

            testLogger.info('Complete cascade cleanup finished', {
                deletedAlerts,
                deletedFolders,
                deletedDestinations,
                deletedTemplates
            });

        } catch (error) {
            testLogger.error('Complete cascade cleanup failed', { error: error.message });
        }
    }

    /**
     * ==========================================
     * PIPELINE-SPECIFIC API METHODS
     * ==========================================
     */

    /**
     * Clean conditions for API (removes UI-only fields)
     * This removes fields like 'id' and 'groupId' that are only used in UI
     * @param {object} conditions - Condition configuration object with UI fields
     * @returns {object} Cleaned conditions for API
     */
    cleanConditionsForAPI(conditions) {
        if (conditions.filterType === "condition") {
            // Remove UI-only fields: id, groupId
            // KEEP values field as it's required by the backend
            const { id, groupId, ...cleaned } = conditions;
            return cleaned;
        } else if (conditions.filterType === "group") {
            // Recursively clean nested conditions
            const { id, groupId, ...cleaned } = conditions;
            cleaned.conditions = conditions.conditions.map(c => this.cleanConditionsForAPI(c));
            return cleaned;
        }
        return conditions;
    }

    /**
     * Create a stream via API
     * @param {string} streamName - Name of the stream to create
     * @param {string} streamType - Type of stream (logs, metrics, traces)
     * @returns {Promise<object>} API response
     */
    async createStream(streamName, streamType = 'logs') {
        const payload = {
            fields: [],
            settings: {
                partition_keys: [],
                index_fields: [],
                full_text_search_keys: [],
                bloom_filter_fields: [],
                defined_schema_fields: [],
                data_retention: 14
            }
        };

        testLogger.info('Creating stream via API', { streamName, streamType });

        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/streams/${streamName}?type=${streamType}`, {
                method: 'POST',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (response.status === 200 && data.code === 200) {
                testLogger.info('Stream created successfully', { streamName });
            } else {
                testLogger.warn('Stream creation returned non-200 or already exists', { streamName, status: response.status, data });
            }

            return { status: response.status, data };
        } catch (error) {
            testLogger.error('Failed to create stream', { streamName, error: error.message });
            return { status: 500, error: error.message };
        }
    }

    /**
     * Create a pipeline via API
     * @param {string} pipelineName - Name of the pipeline
     * @param {string} sourceStream - Source stream name
     * @param {string} destStream - Destination stream name
     * @param {object} conditions - Condition configuration object
     * @returns {Promise<object>} API response
     */
    async createPipeline(pipelineName, sourceStream, destStream, conditions) {
        // Clean conditions to remove UI-only fields
        const cleanedConditions = this.cleanConditionsForAPI(conditions);
        testLogger.info('Cleaned conditions', { cleaned: JSON.stringify(cleanedConditions, null, 2) });

        // Generate unique node IDs
        const inputNodeId = `input-${Date.now()}`;
        const conditionNodeId = `condition-${Date.now()}`;
        const outputNodeId = `output-${Date.now()}`;

        const pipelinePayload = {
            pipeline_id: "",
            version: 0,
            enabled: true,
            org: this.org,
            name: pipelineName,
            description: `Validation test pipeline for ${pipelineName}`,
            source: {
                source_type: "realtime"
            },
            paused_at: null,
            nodes: [
                {
                    id: inputNodeId,
                    position: { x: 100, y: 100 },
                    data: {
                        node_type: "stream",
                        stream_type: "logs",
                        stream_name: sourceStream,
                        org_id: this.org
                    },
                    io_type: "input"
                },
                {
                    id: conditionNodeId,
                    position: { x: 300, y: 200 },
                    data: {
                        node_type: "condition",
                        version: 2,
                        conditions: cleanedConditions
                    },
                    io_type: "default"
                },
                {
                    id: outputNodeId,
                    position: { x: 500, y: 300 },
                    data: {
                        node_type: "stream",
                        stream_type: "logs",
                        stream_name: destStream,
                        org_id: this.org
                    },
                    io_type: "output"
                }
            ],
            edges: [
                {
                    id: `e-${inputNodeId}-${conditionNodeId}`,
                    source: inputNodeId,
                    target: conditionNodeId,
                    markerEnd: {
                        type: "arrowclosed",
                        width: 20,
                        height: 20
                    },
                    type: "custom",
                    style: {
                        strokeWidth: 2
                    },
                    animated: true,
                    updatable: true
                },
                {
                    id: `e-${conditionNodeId}-${outputNodeId}`,
                    source: conditionNodeId,
                    target: outputNodeId,
                    markerEnd: {
                        type: "arrowclosed",
                        width: 20,
                        height: 20
                    },
                    type: "custom",
                    style: {
                        strokeWidth: 2
                    },
                    animated: true,
                    updatable: true
                }
            ],
            type: "realtime",
            stream_name: sourceStream,
            stream_type: "logs"
        };

        testLogger.info('Creating pipeline via API', { pipelineName, sourceStream, destStream });
        testLogger.info('Pipeline payload', { payload: JSON.stringify(pipelinePayload, null, 2) });

        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/pipelines`, {
                method: 'POST',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(pipelinePayload)
            });

            const contentType = response.headers.get('content-type');
            let data;

            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                const text = await response.text();
                data = { error: text };
            }

            testLogger.info('Pipeline creation response', { pipelineName, status: response.status, data });

            if (response.status !== 200) {
                throw new Error(`Pipeline creation failed: ${JSON.stringify(data)}`);
            }

            return { status: response.status, data };
        } catch (error) {
            testLogger.error('Failed to create pipeline', { pipelineName, error: error.message });
            throw error;
        }
    }

    /**
     * Ingest data to a stream
     * Sends records individually to ensure uniqueness
     * @param {string} streamName - Stream name
     * @param {array} data - Array of log objects
     * @returns {Promise<object>} Result with success/fail counts
     */
    async ingestData(streamName, data) {
        testLogger.info('Ingesting data', { streamName, recordCount: data.length });

        let successCount = 0;
        let failCount = 0;

        // Send records one by one to ensure each is treated as unique
        for (let i = 0; i < data.length; i++) {
            const record = data[i];

            try {
                const response = await fetch(`${process.env.INGESTION_URL}/api/${this.org}/${streamName}/_json`, {
                    method: 'POST',
                    headers: {
                        'Authorization': this.authHeader,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify([record])  // Send as single-element array
                });

                const responseData = await response.json();

                if (response.status === 200 && responseData.code === 200) {
                    successCount++;
                    testLogger.debug(`Ingested record ${i+1}/${data.length}`, { name: record.name, test_id: record.test_id || 'no_id', unique_id: record.unique_id });
                } else {
                    failCount++;
                    testLogger.error(`Failed to ingest record ${i+1}/${data.length}`, { response: responseData, test_id: record.test_id || record.name });
                }

                // Small delay between records
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                failCount++;
                testLogger.error(`Error ingesting record ${i+1}/${data.length}`, { error: error.message });
            }
        }

        testLogger.info('Ingestion complete', { streamName, total: data.length, success: successCount, failed: failCount });

        if (failCount > 0) {
            throw new Error(`Failed to ingest ${failCount} out of ${data.length} records`);
        }

        return { total: data.length, success: successCount, failed: failCount };
    }

    /**
     * Query stream via API
     * @param {string} streamName - Stream to query
     * @param {number} expectedMinCount - Minimum expected record count (optional)
     * @returns {Promise<array>} Query results
     */
    async queryStream(streamName, expectedMinCount = null) {
        testLogger.info('Querying stream via API', { streamName });

        // Query for last 10 minutes
        const endTime = Date.now() * 1000; // microseconds
        const startTime = endTime - (10 * 60 * 1000 * 1000);

        const query = {
            query: {
                sql: `SELECT * FROM "${streamName}"`,
                start_time: startTime,
                end_time: endTime,
                from: 0,
                size: 1000
            }
        };

        try {
            const response = await fetch(`${process.env.INGESTION_URL}/api/${this.org}/_search?type=logs`, {
                method: 'POST',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(query)
            });

            const data = await response.json();
            const results = data.hits || [];

            testLogger.info('Query results', { streamName, recordCount: results.length });

            if (expectedMinCount !== null && expectedMinCount !== 0) {
                if (results.length < expectedMinCount) {
                    throw new Error(`Expected at least ${expectedMinCount} records, got ${results.length}`);
                }
            }

            return results;
        } catch (error) {
            testLogger.error('Failed to query stream', { streamName, error: error.message });
            throw error;
        }
    }

    /**
     * ==========================================
     * SDR (Sensitive Data Redaction) CLEANUP METHODS
     * ==========================================
     */

    /**
     * Fetch all regex patterns via API
     * @returns {Promise<Array>} Array of pattern objects with id, name, pattern, description
     */
    async fetchRegexPatterns() {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/re_patterns`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                if (response.status === 404) {
                    testLogger.info('Regex patterns endpoint not available (OSS edition)');
                    return [];
                }
                testLogger.error('Failed to fetch regex patterns', { status: response.status });
                return [];
            }

            const data = await response.json();
            return data.patterns || [];
        } catch (error) {
            testLogger.error('Failed to fetch regex patterns', { error: error.message });
            return [];
        }
    }

    /**
     * Delete a single regex pattern by ID
     * @param {string} patternId - The pattern ID
     * @param {string} patternName - The pattern name (for logging)
     * @returns {Promise<Object>} Deletion result
     */
    async deleteRegexPatternById(patternId, patternName = '') {
        try {
            const response = await fetch(`${this.baseUrl}/api/${this.org}/re_patterns/${patternId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                testLogger.error('Failed to delete regex pattern', { patternId, patternName, status: response.status });
                return { code: response.status, message: 'Failed to delete regex pattern' };
            }

            const result = await response.json();
            return { code: 200, ...result };
        } catch (error) {
            testLogger.error('Failed to delete regex pattern', { patternId, patternName, error: error.message });
            return { code: 500, error: error.message };
        }
    }

    /**
     * Delete regex patterns matching specified prefixes
     * @param {Array<string>} prefixes - Array of pattern name prefixes to match (e.g., ['url_format_hash', 'strong_password_hash'])
     * @returns {Promise<{deleted: number, failed: number}>} Deletion result counts
     */
    async deleteRegexPatternsByPrefix(prefixes = []) {
        testLogger.info('Deleting regex patterns by prefix', { prefixes });

        try {
            const patterns = await this.fetchRegexPatterns();
            testLogger.info('Fetched regex patterns', { total: patterns.length });

            // Filter patterns matching prefixes
            const matchingPatterns = patterns.filter(p =>
                prefixes.some(prefix => p.name.startsWith(prefix) || p.name === prefix)
            );

            testLogger.info('Found patterns matching prefixes', { count: matchingPatterns.length });

            let deletedCount = 0;
            let failedCount = 0;

            for (const pattern of matchingPatterns) {
                const result = await this.deleteRegexPatternById(pattern.id, pattern.name);

                if (result.code === 200) {
                    deletedCount++;
                    testLogger.info('Deleted regex pattern', { name: pattern.name, id: pattern.id });
                } else {
                    failedCount++;
                    testLogger.warn('Failed to delete regex pattern', { name: pattern.name, id: pattern.id, result });
                }
            }

            testLogger.info('Regex patterns deletion completed', {
                total: matchingPatterns.length,
                deleted: deletedCount,
                failed: failedCount
            });

            return { deleted: deletedCount, failed: failedCount };
        } catch (error) {
            testLogger.error('Regex patterns deletion failed', { error: error.message });
            return { deleted: 0, failed: 0 };
        }
    }

    /**
     * Complete SDR test cleanup - deletes streams first (which removes pattern associations), then patterns
     * This should be called in beforeAll hook of SDR tests
     * @param {Array<string>} streamNames - Exact stream names to delete (e.g., ['sdr_combined_hash_test'])
     * @param {Array<string>} patternPrefixes - Pattern name prefixes to delete (e.g., ['url_format_hash', 'strong_password_hash'])
     * @param {Object} options - Optional configuration
     * @param {boolean} options.waitForDeletion - Whether to wait for stream deletions to complete (default: true)
     */
    async cleanupSDRTestData(streamNames = [], patternPrefixes = [], options = {}) {
        const { waitForDeletion = true } = options;

        testLogger.info('=== Starting SDR Test Cleanup via API ===', {
            streams: streamNames,
            patternPrefixes
        });

        try {
            // Step 1: Delete streams first (this automatically unlinks any pattern associations)
            if (streamNames.length > 0) {
                testLogger.info('Step 1: Deleting SDR test streams');

                for (const streamName of streamNames) {
                    testLogger.info(`Attempting to delete stream: ${streamName}`);
                    const result = await this.deleteStream(streamName);

                    if (result.code === 200) {
                        testLogger.info(`✓ Stream deletion initiated: ${streamName}`);
                    } else if (result.code === 404) {
                        testLogger.info(`✓ Stream does not exist (OK): ${streamName}`);
                    } else {
                        testLogger.warn(`Failed to delete stream: ${streamName}`, { result });
                    }
                }

                // Wait for stream deletions to complete if enabled
                if (waitForDeletion) {
                    testLogger.info('Waiting for stream deletions to complete...');
                    for (const streamName of streamNames) {
                        const completed = await this.waitForStreamDeletion(streamName, 60000, 2000);
                        if (completed) {
                            testLogger.info(`✓ Stream deletion complete: ${streamName}`);
                        } else {
                            testLogger.warn(`Stream deletion may still be in progress: ${streamName}`);
                        }
                    }
                }
            }

            // Step 2: Delete patterns by prefix (they should now be unlinked from streams)
            if (patternPrefixes.length > 0) {
                testLogger.info('Step 2: Deleting SDR test patterns');
                const patternResult = await this.deleteRegexPatternsByPrefix(patternPrefixes);
                testLogger.info('Pattern deletion result', patternResult);
            }

            // Wait additional time to ensure backend fully processes deletions
            // This prevents "stream is being deleted" errors when tests immediately try to recreate streams
            testLogger.info('Waiting additional time for backend to finalize deletions...');
            await new Promise(resolve => setTimeout(resolve, 5000));

            testLogger.info('=== SDR Test Cleanup Complete ===');

        } catch (error) {
            testLogger.error('SDR Test Cleanup failed', { error: error.message });
            // Don't throw - allow test to continue even if cleanup fails
        }
    }

    /**
     * ==========================================
     * CORRELATION SETTINGS CLEANUP METHODS
     * ==========================================
     */

    /**
     * Clean up test semantic groups created by correlation settings tests
     * Uses the alerts deduplication config API (same as frontend)
     * Test groups created by ensureSemanticGroupsExist(): k8s-cluster, k8s-namespace, k8s-deployment, service
     * @param {Array<string>} groupIds - Array of semantic group IDs to delete (default: test group IDs)
     */
    async cleanupCorrelationSettings(groupIds = ['k8s-cluster', 'k8s-namespace', 'k8s-deployment', 'service']) {
        testLogger.info('Starting correlation settings cleanup', { groupIds });

        try {
            // First, fetch the current deduplication config
            const getResponse = await fetch(`${this.baseUrl}/api/${this.org}/alerts/deduplication/config`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            if (!getResponse.ok) {
                if (getResponse.status === 404) {
                    testLogger.info('Deduplication config not found (nothing to clean up)');
                    return;
                }
                testLogger.warn('Failed to fetch deduplication config', { status: getResponse.status });
                return;
            }

            const config = await getResponse.json();
            const currentGroups = config.semantic_field_groups || [];
            testLogger.info('Current semantic groups in dedup config', { count: currentGroups.length });

            if (currentGroups.length === 0) {
                testLogger.info('No semantic groups to clean up');
                return;
            }

            // Filter out the test groups
            const remainingGroups = currentGroups.filter(g => !groupIds.includes(g.id));
            const removedCount = currentGroups.length - remainingGroups.length;

            if (removedCount === 0) {
                testLogger.info('No test semantic groups found to clean up');
                return;
            }

            testLogger.info('Removing test semantic groups', {
                total: currentGroups.length,
                removing: removedCount,
                remaining: remainingGroups.length
            });

            // Update the config with remaining groups
            const updatePayload = {
                ...config,
                semantic_field_groups: remainingGroups,
                // Also clean up fingerprint groups that reference removed semantic groups
                alert_fingerprint_groups: (config.alert_fingerprint_groups || [])
                    .filter(id => !groupIds.includes(id))
            };

            const updateResponse = await fetch(`${this.baseUrl}/api/${this.org}/alerts/deduplication/config`, {
                method: 'POST',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updatePayload)
            });

            if (updateResponse.ok) {
                testLogger.info('Correlation settings cleanup completed', { removedGroups: removedCount });
            } else {
                testLogger.warn('Failed to update deduplication config', { status: updateResponse.status });
            }

        } catch (error) {
            testLogger.error('Correlation settings cleanup failed', { error: error.message });
        }
    }

    /**
     * Verify stream exists via API
     * @param {string} streamName - Name of the stream to verify
     * @returns {Promise<boolean>} True if stream exists
     */
    async verifyStreamExists(streamName) {
        try {
            const response = await fetch(`${process.env.INGESTION_URL}/api/${this.org}/streams`, {
                method: 'GET',
                headers: {
                    'Authorization': this.authHeader,
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (response.status === 200 && data.list) {
                const streamExists = data.list.some(s => s.name === streamName);
                testLogger.info('Stream existence check', { streamName, exists: streamExists });
                return streamExists;
            }

            testLogger.warn('Failed to check stream existence', { streamName, status: response.status });
            return false;
        } catch (error) {
            testLogger.error('Error checking stream existence', { streamName, error: error.message });
            return false;
        }
    }
}

module.exports = APICleanup;