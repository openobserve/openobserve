/**
 * Cross-worker setup barrier for the Service Graph suite.
 *
 * PROBLEM THIS SOLVES
 * -------------------
 * service-graph.spec.js runs with `mode: 'parallel'`, so Playwright gives each
 * test its own worker process — and `beforeAll` therefore runs once *per
 * worker*. Every worker was independently ingesting the same 33 traces and then
 * opening its own 4-minute poll against the topology API. On the alpha1 cloud
 * suite that is 3+ concurrent ingest storms and 3+ concurrent pollers, on a
 * backend that is already carrying 12 other shards now that the alpha1 matrix
 * runs in parallel.
 *
 * Worse, when the poll gave up it only logged a warning and let the tests run
 * against an empty topology, which turned a slow daemon into five hard
 * assertion failures (`expect(nodes.length).toBeGreaterThanOrEqual(10)` →
 * received 0). That is exactly the signature seen in run 30447620921 on both
 * attempts.
 *
 * HOW IT WORKS
 * ------------
 * Workers race for an atomic `fs.mkdirSync` on a lock directory inside the
 * Playwright output dir (workers are separate processes on the same runner, so
 * the filesystem is the natural rendezvous point):
 *
 *   - The winner ingests, then polls until the topology actually reports the
 *     expected node AND edge counts, re-ingesting between rounds because a
 *     second ingestion is what has been observed to unstick a lagging daemon.
 *     It then writes a `ready.json` marker.
 *   - Every other worker waits for that marker and then confirms the topology
 *     itself before returning, so a stale/partial marker can never let a test
 *     start against empty data.
 *   - If the winner dies without writing the marker, the lock goes stale and a
 *     waiter takes over the ingestion role rather than deadlocking.
 *
 * The marker lives under the run's output dir, which Playwright clears at the
 * start of each run, so it is scoped to a single suite execution.
 */

const fs = require('fs');
const path = require('path');

const testLogger = require('./test-logger.js');
const {
  generateFullTopology,
  generateAllEdgeCases,
  ingestTraces,
  waitForTopologyReady,
  getOrgId,
} = require('./service-graph-ingestion.js');

// A worker that holds the lock but stops updating its heartbeat for this long is
// treated as dead so the remaining workers can take over instead of deadlocking.
const STALE_LOCK_MS = 90_000;

function lockPaths(outputDir) {
  const root = path.join(outputDir, `.service-graph-setup-${getOrgId()}`);
  return {
    root,
    heartbeat: path.join(root, 'heartbeat'),
    ready: path.join(root, 'ready.json'),
    failed: path.join(root, 'failed.json'),
  };
}

function touch(file, contents = '') {
  try {
    fs.writeFileSync(file, contents);
  } catch {
    /* best effort — the marker is an optimisation, the topology check is the truth */
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function lockIsStale(paths) {
  try {
    return Date.now() - fs.statSync(paths.heartbeat).mtimeMs > STALE_LOCK_MS;
  } catch {
    // No heartbeat file at all — the holder never got as far as writing one.
    try {
      return Date.now() - fs.statSync(paths.root).birthtimeMs > STALE_LOCK_MS;
    } catch {
      return true;
    }
  }
}

/**
 * Ingest the service-graph fixture traces and block until the topology API
 * actually reports them.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {number} [opts.minNodes=10]
 * @param {number} [opts.minEdges=10]
 * @param {number} [opts.rounds=3] Ingest/poll rounds before giving up.
 * @param {number} [opts.roundWaitMs=120000] Poll budget per round.
 * @returns {Promise<{nodes: number, edges: number}>}
 * @throws if the topology never reaches the expected counts.
 */
async function ingestAndAwaitTopology(page, {
  minNodes = 10,
  minEdges = 10,
  rounds = 3,
  roundWaitMs = 120_000,
  onProgress = () => {},
} = {}) {
  let last = { success: false, nodes: 0, edges: 0 };

  for (let round = 1; round <= rounds; round++) {
    const traces = [...generateFullTopology({ tracesPerFlow: 3, errorRate: 0.2 }), ...generateAllEdgeCases()];
    testLogger.info(`Service graph setup round ${round}/${rounds}: ingesting ${traces.length} traces`);
    await ingestTraces(page, traces, { delayMs: 50 });
    onProgress();

    last = await waitForTopologyReady(page, {
      minNodes,
      minEdges,
      maxWaitMs: roundWaitMs,
      pollIntervalMs: 5000,
    });
    onProgress();

    if (last.success) {
      testLogger.info(
        `Service graph topology ready after round ${round}: ${last.nodes} nodes, ${last.edges} edges`
      );
      return { nodes: last.nodes, edges: last.edges };
    }

    testLogger.warn(
      `Service graph topology not ready after round ${round} (${last.nodes} nodes, ${last.edges} edges) — re-ingesting`
    );
  }

  throw new Error(
    `Service graph topology never reached ${minNodes} nodes / ${minEdges} edges ` +
    `after ${rounds} ingest rounds (last seen: ${last.nodes} nodes, ${last.edges} edges). ` +
    `The service graph daemon did not process the ingested traces in time.`
  );
}

/**
 * Ensure the service graph topology is populated, doing the ingestion at most
 * once per shard no matter how many workers call this.
 *
 * @param {import('@playwright/test').Page} page An authenticated page.
 * @param {string} outputDir Playwright's `testInfo.project.outputDir`.
 * @param {object} [opts] Forwarded to {@link ingestAndAwaitTopology}.
 */
async function ensureServiceGraphData(page, outputDir, opts = {}) {
  const { minNodes = 10, minEdges = 10 } = opts;
  const paths = lockPaths(outputDir);

  fs.mkdirSync(path.dirname(paths.root), { recursive: true });

  let isOwner = false;
  try {
    fs.mkdirSync(paths.root); // atomic — exactly one worker wins
    isOwner = true;
  } catch {
    isOwner = false;
  }

  if (isOwner) {
    touch(paths.heartbeat, String(Date.now()));
    try {
      const result = await ingestAndAwaitTopology(page, {
        ...opts,
        onProgress: () => touch(paths.heartbeat, String(Date.now())),
      });
      touch(paths.ready, JSON.stringify({ ...result, at: Date.now() }));
      return result;
    } catch (error) {
      // Record the failure so waiters fail fast with the same reason instead of
      // burning their own full ingest budget against the same broken backend.
      touch(paths.failed, JSON.stringify({ error: String(error.message || error), at: Date.now() }));
      throw error;
    }
  }

  // Not the owner: wait for the owner's marker, then verify the topology
  // ourselves. Never trust the marker alone.
  const waitDeadline = Date.now() + (opts.rounds ?? 3) * (opts.roundWaitMs ?? 120_000) + 60_000;
  while (Date.now() < waitDeadline) {
    if (fs.existsSync(paths.ready)) {
      const ready = await waitForTopologyReady(page, { minNodes, minEdges, maxWaitMs: 60_000 });
      if (ready.success) return { nodes: ready.nodes, edges: ready.edges };
      break; // marker present but data gone — fall through and ingest ourselves
    }

    const failure = readJson(paths.failed);
    if (failure) throw new Error(`Service graph setup failed in the owning worker: ${failure.error}`);

    if (lockIsStale(paths)) {
      testLogger.warn('Service graph setup lock went stale — taking over ingestion');
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // Owner died, never finished, or produced data that has since disappeared.
  const result = await ingestAndAwaitTopology(page, {
    ...opts,
    onProgress: () => touch(paths.heartbeat, String(Date.now())),
  });
  touch(paths.ready, JSON.stringify({ ...result, at: Date.now() }));
  return result;
}

module.exports = {
  ensureServiceGraphData,
  ingestAndAwaitTopology,
};
