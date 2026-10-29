// Copyright 2026 OpenObserve Inc.

// Tests that nominate the org default team and tests that need an unrouted page live in different files, so only a cross-worker lock orders them.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const testLogger = require('./test-logger.js');

/** The lock every test touching the org's default routing team takes. */
const DEFAULT_TEAM_LOCK = 'oncall-default-team';

// Outlasts routing's whole default-team group (TS-14.01/02, TS-14.03's 15 minutes, TS-14.04), which can retake the lock back to back.
const ORG_LOCK_WAIT_MS = 25 * 60 * 1000;

// A lock dir whose pid file is empty or unreadable this long after its last write is corrupt, not being stamped.
const UNSTAMPED_STALE_MS = 5000;

const heldHere = new Set();

function lockDir(name) {
  const server = String(process.env.ZO_BASE_URL || 'local').replace(/[^a-z0-9]+/gi, '_');
  return path.join(os.tmpdir(), `o2-e2e-lock_${server}_${name}`);
}

function readHolder(dir) {
  let pid = 0;
  try {
    const stat = fs.statSync(dir);
    try {
      pid = Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8')) || 0;
    } catch {
      pid = 0;
    }
    // Released and replaced between the two reads: the pid is not this lock's, so look again.
    if (fs.statSync(dir).ino !== stat.ino) return null;
    return { pid, id: `${stat.ino}-${Math.trunc(stat.mtimeMs)}`, ageMs: Date.now() - stat.mtimeMs };
  } catch {
    return null;
  }
}

function isStale({ pid, ageMs }) {
  if (!pid) return ageMs > UNSTAMPED_STALE_MS;
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e.code !== 'EPERM';
  }
}

function takeOver(dir, holder) {
  // The tombstone is kept and named after the dead lock, so a second waiter's rename onto it fails instead of moving a fresh lock.
  const tomb = `${dir}.stale-${holder.id}`;
  try {
    fs.renameSync(dir, tomb);
  } catch {
    return false;
  }
  for (const entry of fs.readdirSync(path.dirname(dir))) {
    const other = path.join(path.dirname(dir), entry);
    if (other !== tomb && other.startsWith(`${dir}.stale-`)) fs.rmSync(other, { recursive: true, force: true });
  }
  testLogger.info('Org lock taken over from a dead holder', { dir, deadPid: holder.pid });
  return true;
}

/** Take the named lock, waiting for whichever worker holds it, and return its release function; pass testInfo so the wait does not eat the test's own budget. */
async function acquireOrgLock(name, { testInfo, timeout = ORG_LOCK_WAIT_MS, pollMs = 1000 } = {}) {
  if (heldHere.has(name)) {
    throw new Error(`org lock "${name}" is already held by this worker (pid ${process.pid}); release it before taking it again`);
  }
  const dir = lockDir(name);
  const started = Date.now();
  testInfo?.setTimeout(testInfo.timeout + timeout);
  // Built complete in a private dir and renamed into place, so a lock never exists without its pid.
  const fresh = `${dir}.new-${process.pid}-${started}`;
  fs.mkdirSync(fresh);
  fs.writeFileSync(path.join(fresh, 'pid'), String(process.pid));
  try {
    for (;;) {
      try {
        fs.renameSync(fresh, dir);
        break;
      } catch (e) {
        if (e.code !== 'ENOTEMPTY' && e.code !== 'EEXIST') throw e;
      }
      const holder = readHolder(dir);
      if (!holder || (isStale(holder) && takeOver(dir, holder))) continue;
      if (Date.now() - started > timeout) {
        throw new Error(`waited ${timeout}ms for the org-wide lock "${name}" (${dir}); pid ${holder.pid || 'unknown'} still holds it`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  } catch (e) {
    fs.rmSync(fresh, { recursive: true, force: true });
    throw e;
  }
  const waited = Date.now() - started;
  testInfo?.setTimeout(testInfo.timeout - timeout + waited);
  heldHere.add(name);
  testLogger.info('Org lock taken', { name, pid: process.pid, waitedMs: waited });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    heldHere.delete(name);
    if (readHolder(dir)?.pid !== process.pid) return;
    // Renamed away before deleting, so the lock path is never an empty dir another worker's rename could replace.
    const gone = `${dir}.released-${process.pid}-${Date.now()}`;
    fs.renameSync(dir, gone);
    fs.rmSync(gone, { recursive: true, force: true });
    testLogger.info('Org lock released', { name, pid: process.pid });
  };
}

module.exports = { DEFAULT_TEAM_LOCK, acquireOrgLock };
