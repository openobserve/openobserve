const metricsIngestion = require('./metrics-ingestion.js');
const testLogger = require('./test-logger.js');

// Track if metrics have been ingested in this test run
let metricsIngested = false;
let ingestionPromise = null;

/**
 * Ensures metrics are ingested once for the entire test run
 * This prevents multiple parallel test files from trying to ingest simultaneously
 */
async function ensureMetricsIngested() {
    // If already ingested, return immediately
    if (metricsIngested) {
        testLogger.debug('Metrics already ingested for this test run');
        return { success: true, alreadyIngested: true };
    }

    // If ingestion is in progress, wait for it
    if (ingestionPromise) {
        testLogger.debug('Metrics ingestion already in progress, waiting...');
        return await ingestionPromise;
    }

    // Start ingestion and track the promise
    ingestionPromise = performIngestion();
    const result = await ingestionPromise;

    if (result.success) {
        metricsIngested = true;
    }

    return result;
}

async function performIngestion() {
    testLogger.info('Starting one-time metrics ingestion for test suite');

    try {
        // First, check if the endpoint is ready
        const config = metricsIngestion.config;
        const isReady = await metricsIngestion.waitForEndpoint(config, 15, 2000); // 15 retries, 2 second initial delay

        if (!isReady) {
            testLogger.warn('Metrics endpoint not ready, attempting ingestion anyway');
        }

        // Perform ingestion with smaller batches initially to warm up
        const warmupResult = await metricsIngestion.ingestTestMetrics({
            iterations: 5,   // Small warmup batch
            delay: 500,      // 500ms between warmup batches
            useExternal: false
        });

        if (!warmupResult.success) {
            testLogger.warn('Warmup ingestion failed, but continuing with main ingestion');
        }

        // Main ingestion with reduced batch size to avoid overwhelming the system
        const result = await metricsIngestion.ingestTestMetrics({
            iterations: 20,  // Reduced from 50 to 20 for stability
            delay: 200,      // 200ms between batches
            useExternal: false
        });

        if (result.success) {
            testLogger.info('One-time metrics ingestion successful', {
                batches: result.totalBatches,
                successful: result.successfulBatches
            });
        } else {
            testLogger.warn('One-time metrics ingestion had some failures', {
                batches: result.totalBatches,
                successful: result.successfulBatches,
                failed: result.totalBatches - result.successfulBatches
            });
        }

        // CRITICAL: Add delay to allow metrics to be indexed
        testLogger.info('Waiting 5 seconds for metrics to be fully indexed...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        testLogger.info('Indexing delay complete, metrics should be queryable');

        return result;
    } catch (error) {
        testLogger.error('One-time metrics ingestion failed', { error: error.message });
        return { success: false, error: error.message };
    }
}

module.exports = { ensureMetricsIngested };