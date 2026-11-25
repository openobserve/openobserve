import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

// Shared by every harness process in the container: the run lock, the cooldown clock and the report outbox live here.
export function defaultStateDir(env = process.env) {
  return env.REVIEW_EXPERIMENT_STATE_DIR || join(tmpdir(), "o2-ai-review-experiments");
}

function writeJson(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

// The lock port is derived from the work directory's real path, so every harness that shares the directory contends for the same one,
// whether it names it directly or through a symlink.
export function lockPortFor(stateDir) {
  const real = realpathSync(stateDir);
  return 40_000 + (Number.parseInt(createHash("sha256").update(real).digest("hex").slice(0, 6), 16) % 20_000);
}

// One run at a time (two would warm each other's provider cache): a loopback port the OS grants to one process and frees when it dies.
// Connections are closed on arrival, and an engine group left by a dead run keeps the lock refused until it is gone (README).
export async function acquireRunLock(stateDir, { port, now = Date.now } = {}) {
  mkdirSync(stateDir, { recursive: true });
  port ??= lockPortFor(stateDir);
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", err => rejectPromise(err.code === "EADDRINUSE" ? new Error(`another experiment run is active (it holds lock port ${port}); runs are serialized`) : err));
    server.listen(port, "127.0.0.1", resolvePromise);
  });
  const release = () => new Promise(resolvePromise => server.close(() => resolvePromise()));
  try {
    const left = readJson(groupPath(stateDir));
    if (left) {
      // Probe first: the review ended no later than the time sampled after the probe says it is gone, so the cooldown never starts early.
      const alive = groupAlive(left.pgid);
      touchCooldown(stateDir, left.rowKey, now());
      if (alive) throw new Error(`the engine process group ${left.pgid} of an earlier run (row ${left.rowKey}) is still running; wait for it to end`);
      clearEngineGroup(stateDir);
    }
  } catch (err) {
    await release();
    throw err;
  }
  return release;
}

const groupPath = stateDir => join(stateDir, "engine-group.json");

// Written as soon as the engine starts and removed once its group is gone, so a harness that dies leaves the review's tree on record.
export function recordEngineGroup(stateDir, pgid, rowKey) {
  mkdirSync(stateDir, { recursive: true });
  writeJson(groupPath(stateDir), { pgid, rowKey });
}

export function clearEngineGroup(stateDir) {
  rmSync(groupPath(stateDir), { force: true });
}

function groupAlive(pgid) {
  if (!Number.isInteger(pgid) || pgid <= 1) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

const cooldownPath = stateDir => join(stateDir, "cooldown.json");

// `all` is the last moment any run was active, `rows` the same per row. A start counts as activity, so a run cut off mid-way still holds its cooldown.
export function readCooldown(stateDir) {
  const state = readJson(cooldownPath(stateDir));
  return { all: Number(state?.all) || 0, rows: state?.rows && typeof state.rows === "object" ? state.rows : {} };
}

export function touchCooldown(stateDir, rowKey, at) {
  mkdirSync(stateDir, { recursive: true });
  const state = readCooldown(stateDir);
  writeJson(cooldownPath(stateDir), { all: at, rows: { ...state.rows, [rowKey]: at } });
}

// `all`: after any run, `row`: only after a run of the same row.
export function cooldownWaitMs({ state, rowKey, gapMs, scope, now }) {
  const last = scope === "row" ? Number(state.rows[rowKey]) || 0 : state.all;
  return Math.max(0, last + gapMs - now);
}

// ─── outbox: the exact report body of each slot, kept until the server has accepted every part of it ───

const outboxDir = (stateDir, experimentId) => join(stateDir, "outbox", createHash("sha256").update(experimentId).digest("hex").slice(0, 24));
const outboxPath = (stateDir, experimentId, rowId, trialIndex) => join(outboxDir(stateDir, experimentId), `${createHash("sha256").update(String(rowId)).digest("hex").slice(0, 24)}-${trialIndex}.json`);

export function saveOutbox(stateDir, experimentId, entry) {
  mkdirSync(outboxDir(stateDir, experimentId), { recursive: true });
  writeJson(outboxPath(stateDir, experimentId, entry.rowId, entry.trialIndex), entry);
}

export function readOutbox(stateDir, experimentId, rowId, trialIndex) {
  return readJson(outboxPath(stateDir, experimentId, rowId, trialIndex));
}

// Entries are keyed by slot, so the caller asks for the slots it knows rather than listing a directory of unknown files.
export function pendingOutbox(stateDir, experimentId, slots) {
  return slots
    .map(slot => readOutbox(stateDir, experimentId, slot.rowId, slot.trialIndex))
    .filter(entry => entry && entry.status !== "accepted");
}

// Harness files (outbox, cooldown, lock) live in the work directory. The review's tree must never be that directory or sit under it: the
// read-only config denies reads outside PR_DIR, which only holds if nothing of the harness's is inside it or above it.
export function workDirProblem(stateDir, prDir) {
  const state = resolve(stateDir);
  const pr = resolve(prDir);
  const within = (path, root) => path === root || path.startsWith(`${root}${sep}`);
  if (within(pr, state)) return `the work directory ${state} is PR_DIR or an ancestor of it`;
  if (within(state, pr)) return `the work directory ${state} is inside PR_DIR`;
  return "";
}
