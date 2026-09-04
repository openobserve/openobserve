const path = require('path');
const fs = require('fs');
const { request } = require('@playwright/test');
const testLogger = require('./test-logger.js');
const { purgeOldRumStreamData } = require('./rum-stream-verify.js');

/**
 * Opt-in cleanup of accumulated RUM stream data on long-lived test instances.
 * The RUM dataflow specs POST real rows into the shared _rumdata / _rumlog /
 * _sessionreplay streams, and OpenObserve has no predicate-scoped delete (see
 * purgeOldRumStreamData) — so per-run rows cannot be removed individually.
 * Running once here, after every test in the shard has finished, is the only
 * concurrency-safe place to bound that growth. Default-off; enable with
 * ZO_RUM_PURGE_STREAM_DATA=true on a dedicated RUM test instance.
 */
async function purgeRumDataIfEnabled() {
  if (process.env.ZO_RUM_PURGE_STREAM_DATA !== 'true') return;
  const olderThanHours = Number(process.env.ZO_RUM_PURGE_OLDER_THAN_HOURS || 24);
  let ctx;
  try {
    ctx = await request.newContext();
    const results = await purgeOldRumStreamData(ctx, { olderThanHours });
    testLogger.info('RUM stream data purge requested', { olderThanHours, results });
  } catch (error) {
    // Best-effort — never fail the run on cleanup.
    testLogger.warn('RUM stream data purge failed', { error: error.message });
  } finally {
    if (ctx) await ctx.dispose().catch(() => {});
  }
}

/**
 * Global teardown for all tests
 * This runs once after all tests complete
 */
async function globalTeardown() {
  testLogger.info('Starting global teardown');

  try {
    // Note: We intentionally do NOT delete user.json here.
    // Global setup recreates it each run, and deleting it mid-run
    // causes race conditions when multiple test files run in parallel.

    await purgeRumDataIfEnabled();

    testLogger.info('✅ Global teardown completed');

  } catch (error) {
    testLogger.error('Global teardown failed', { error });
    // Don't throw error to avoid failing the entire test run
  }
}

module.exports = globalTeardown;