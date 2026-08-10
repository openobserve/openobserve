// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Blocking chains — two perspectives on one sample set.
 *
 * "Who's stuck" is the default because the incident arrives worded that way:
 * my query is hanging. It is a flat list sorted by wait time, so the worst-hit
 * query is row 1. "Who's blocking" re-roots the same data at the session
 * holding the lock, because that is where the fix is.
 */

import type { BlockingChain, BlockingChainNode, BlockingSample } from "@/services/db_monitoring";
import type { I18nKey } from "@/types/i18n";

/**
 * Accept one wire sample.
 *
 * The server sends this module's vocabulary directly — `blocked_pid`,
 * `blocking_application`, `db_system` — so no renaming is left to do here. What
 * remains is the guard: a sample with no waiting pid is dropped, because
 * "somebody is blocked" with no identity cannot be placed in a chain or acted
 * on.
 */
export const parseBlockingSample = (hit: BlockingSample): BlockingSample | null => {
  if (hit.blocked_pid == null) return null;
  return hit;
};

export const parseBlockingSamples = (hits: BlockingSample[]): BlockingSample[] =>
  hits.map(parseBlockingSample).filter((s): s is BlockingSample => s !== null);

/** Which question the table is answering. */
export type BlockingPerspective = "waiting" | "blocking";

export const DEFAULT_BLOCKING_PERSPECTIVE: BlockingPerspective = "waiting";

/** One row of the "who's stuck" list. */
export interface WaitingRow extends BlockingSample {
  rowKey: string;
  /** How many hops from this session up to the root blocker. 1 = its blocker
   *  IS the root. */
  depth: number;
  /** The session at the top of this row's chain — the one to actually act on. */
  rootPid: number | null;
  /** Its direct blocker is itself waiting, so the real culprit is further up.
   *  This is what the `2 deep` chip on the row is about. */
  blockerIsWaiting: boolean;
  /** Longest wait in the set, for the bar's scale. */
  waitShare: number;
}

/** One row of the "who's blocking" tree — a root or a waiter beneath it. */
export interface ChainRow {
  rowKey: string;
  /** 0 = the root blocker. */
  depth: number;
  pid: number | null;
  query?: string | null;
  application?: string | null;
  fingerprint?: string | null;
  db_system: string;
  db_instance?: string | null;
  /** The session this one waits on. `null` on the root. */
  waitingOnPid: number | null;
  waitSeconds: number | null;
  /** How many sessions are stuck below this one, at every depth. */
  blockingCount: number;
  /** Which of the three states this row is in — the pill it renders. */
  kind: "root" | "waiting-blocking" | "waiting";
  /** Seconds since a root last ran a statement. */
  idleSeconds?: number | null;
  /** The class of wait — `Lock`. Null on the root, which waits for nothing. */
  waitEventType?: string | null;
  /** What specifically is being waited on — `transactionid`, `tuple`. */
  waitEvent?: string | null;
  waitShare: number;
  /** Ancestor-has-more-siblings flags, outermost first — draws the connector
   *  rails. `true` means that ancestor level still has rows below it, so its
   *  vertical rail continues past this row. */
  rails: boolean[];
  /** This row is the last child of its parent, so its rail stops at the elbow. */
  isLast: boolean;
}

const sampleKey = (s: BlockingSample) => `${s.db_system}:${s.db_instance ?? ""}:${s.blocked_pid}`;

/**
 * Walk `blocking_pid` up to the session that is not itself waiting. Returns the
 * root pid and the hop count. A cycle — which the database itself would have
 * resolved as a deadlock, but which can appear in a sample taken mid-flight —
 * terminates on the visited set rather than spinning.
 */
export const resolveRoot = (
  pid: number,
  blockerByPid: Map<number, number | null>,
): { rootPid: number | null; depth: number } => {
  const seen = new Set<number>([pid]);
  let current = pid;
  let depth = 0;
  for (;;) {
    const next = blockerByPid.get(current);
    if (next == null) return { rootPid: current === pid ? null : current, depth };
    depth += 1;
    if (seen.has(next)) return { rootPid: next, depth };
    seen.add(next);
    // The blocker is not itself waiting: it is the root.
    if (!blockerByPid.has(next)) return { rootPid: next, depth };
    current = next;
  }
};

/**
 * The "who's stuck" rows — every waiting session, longest wait first, each
 * carrying how deep it sits and whether its blocker is itself stuck.
 */
/**
 * When the top row's wait is genuinely worth pointing at.
 *
 * The badge used to fire on `index === 0` alone, so it always sat on row 1 — on
 * a page where every wait is 0.1s that labels a non-event as the worst thing on
 * screen, and a badge that is always present carries no information. Both guards
 * must agree: it has to be a wait somebody would notice, AND clearly worse than
 * the next one, or "longest" is just describing the sort order the reader can
 * already see.
 */
export const LONGEST_WAIT_RULES = {
  /** Below this, a wait is not something a user would notice. */
  minSeconds: 5,
  /** ...and it must be at least this multiple of the runner-up. */
  minRatioToNext: 2,
} as const;

export const isNotablyLongestWait = (
  waitSeconds: number | null | undefined,
  nextWaitSeconds: number | null | undefined,
): boolean => {
  const { minSeconds, minRatioToNext } = LONGEST_WAIT_RULES;
  const wait = waitSeconds ?? 0;
  if (wait < minSeconds) return false;
  const next = nextWaitSeconds ?? 0;
  // Sole waiter: nothing to be twice as bad as, and it already cleared the floor.
  if (next <= 0) return true;
  return wait >= minRatioToNext * next;
};

export const buildWaitingRows = (samples: BlockingSample[]): WaitingRow[] => {
  const blockerByPid = new Map<number, number | null>();
  for (const s of samples) blockerByPid.set(s.blocked_pid, s.blocking_pid);

  const longest = samples.reduce((max, s) => Math.max(max, s.wait_seconds ?? 0), 0);

  return samples
    .map((s) => {
      const { rootPid, depth } = resolveRoot(s.blocked_pid, blockerByPid);
      return {
        ...s,
        rowKey: sampleKey(s),
        depth,
        rootPid,
        blockerIsWaiting: s.blocking_pid != null && blockerByPid.has(s.blocking_pid),
        waitShare: longest > 0 ? (s.wait_seconds ?? 0) / longest : 0,
      };
    })
    .sort((a, b) => (b.wait_seconds ?? 0) - (a.wait_seconds ?? 0));
};

/**
 * Rebuild root-blocker chains from flat samples. The server sends `chains[]`
 * when it can — it sees the whole sample set, so it can climb past a blocker
 * that fell outside the row limit — and this is the fallback that keeps the
 * tree working before that lands.
 */
export const chainsFromSamples = (samples: BlockingSample[]): BlockingChain[] => {
  const blockerByPid = new Map<number, number | null>();
  for (const s of samples) blockerByPid.set(s.blocked_pid, s.blocking_pid);

  const byRoot = new Map<number, BlockingSample[]>();
  for (const s of samples) {
    const { rootPid } = resolveRoot(s.blocked_pid, blockerByPid);
    if (rootPid == null) continue;
    const bucket = byRoot.get(rootPid);
    if (bucket) bucket.push(s);
    else byRoot.set(rootPid, [s]);
  }

  const chains: BlockingChain[] = [];
  for (const [rootPid, waiters] of byRoot) {
    // The root's own identity is only visible as the `blocking_*` side of the
    // samples that name it directly.
    const direct = waiters.find((w) => w.blocking_pid === rootPid);
    const depths = waiters.map((w) => resolveRoot(w.blocked_pid, blockerByPid).depth);

    const childrenOf = new Map<number, BlockingSample[]>();
    for (const w of waiters) {
      if (w.blocking_pid == null) continue;
      const bucket = childrenOf.get(w.blocking_pid);
      if (bucket) bucket.push(w);
      else childrenOf.set(w.blocking_pid, [w]);
    }

    /** Build the same nested shape the server sends, so one walker serves both. */
    const build = (pid: number, depth: number, guard: Set<number>): BlockingChainNode[] =>
      [...(childrenOf.get(pid) ?? [])]
        .sort((a, b) => (b.wait_seconds ?? 0) - (a.wait_seconds ?? 0))
        .filter((kid) => !guard.has(kid.blocked_pid))
        .map((kid) => {
          guard.add(kid.blocked_pid);
          return {
            pid: kid.blocked_pid,
            app: kid.blocked_application ?? null,
            query: kid.blocked_query ?? null,
            fingerprint: kid.blocked_fingerprint ?? null,
            wait_seconds: kid.wait_seconds ?? null,
            wait_event_type: kid.wait_event_type ?? null,
            wait_event: kid.wait_event ?? null,
            depth,
            children: build(kid.blocked_pid, depth + 1, guard),
          };
        });

    chains.push({
      root: {
        pid: rootPid,
        app: direct?.blocking_application ?? null,
        query: direct?.blocking_query ?? null,
        fingerprint: direct?.blocking_fingerprint ?? null,
        wait_seconds: null,
        depth: 0,
        children: build(rootPid, 1, new Set([rootPid])),
      },
      root_pid: rootPid,
      root_query: direct?.blocking_query ?? null,
      root_app: direct?.blocking_application ?? null,
      root_fingerprint: direct?.blocking_fingerprint ?? null,
      blocked_count: waiters.length,
      depth: depths.length ? Math.max(...depths) : 0,
      max_wait_seconds: waiters.reduce((max, w) => Math.max(max, w.wait_seconds ?? 0), 0),
      engine: waiters[0].db_system,
      database: waiters[0].db_instance ?? null,
    });
  }

  return chains.sort((a, b) => b.blocked_count - a.blocked_count || b.root_pid - a.root_pid);
};

/** Seconds since the root last ran a statement, when the sample carried it. */
export const rootIdleSeconds = (chain: BlockingChain, samples: BlockingSample[]): number | null =>
  samples.find((s) => s.blocking_pid === chain.root_pid)?.blocker_idle_seconds ?? null;

/**
 * Flatten chains into table rows — depth-first, root first, so the indent alone
 * carries the hierarchy and every row stays sortable alongside the others.
 * A 3-deep chain is 3 rows; there is no drawer and no modal.
 */
export const flattenChains = (
  chains: BlockingChain[],
  /** Idle time lives on the samples, not on the chain, so the root's
   *  "forgot to commit" note needs them to be resolvable. */
  samples: BlockingSample[] = [],
): ChainRow[] => {
  const rows: ChainRow[] = [];

  for (const chain of chains) {
    const engine = chain.engine ?? "";
    const database = chain.database ?? "";
    const prefix = `${engine}:${database}`;

    /** Every session stuck below this node, at any depth. */
    const countBelow = (node: BlockingChainNode, seen: Set<number>): number => {
      if (seen.has(node.pid)) return 0;
      seen.add(node.pid);
      return (node.children ?? []).reduce((sum, kid) => sum + 1 + countBelow(kid, seen), 0);
    };

    const root = chain.root;
    const longest =
      chain.max_wait_seconds ??
      (root ? Math.max(0, ...(root.children ?? []).map((c) => c.wait_seconds ?? 0)) : 0);
    const scale = (seconds: number | null | undefined) =>
      longest > 0 ? (seconds ?? 0) / longest : 0;

    rows.push({
      rowKey: `${prefix}:root:${chain.root_pid}`,
      depth: 0,
      pid: chain.root_pid,
      query: chain.root_query ?? root?.query ?? null,
      application: chain.root_app ?? root?.app ?? null,
      fingerprint: chain.root_fingerprint ?? root?.fingerprint ?? null,
      db_system: engine,
      db_instance: chain.database ?? null,
      waitingOnPid: null,
      // The root is the session everything else waits on; it waits for nothing.
      waitSeconds: null,
      blockingCount: chain.blocked_count,
      kind: "root",
      idleSeconds: rootIdleSeconds(chain, samples),
      // The root holds the lock; it is not itself waiting on anything.
      waitEventType: null,
      waitEvent: null,
      waitShare: 0,
      rails: [],
      isLast: true,
    });

    /**
     * Depth-first, so the indent alone carries the hierarchy. `guard` stops a
     * cyclic chain (`chain.cyclic`) from recursing forever — the database
     * resolves a true cycle as a deadlock, but a sample can catch one in
     * flight.
     */
    const walk = (node: BlockingChainNode, depth: number, rails: boolean[], guard: Set<number>) => {
      const kids = [...(node.children ?? [])].sort(
        (a, b) => (b.wait_seconds ?? 0) - (a.wait_seconds ?? 0),
      );
      kids.forEach((kid, index) => {
        if (guard.has(kid.pid)) return;
        guard.add(kid.pid);
        const isLast = index === kids.length - 1;
        const below = countBelow(kid, new Set());
        rows.push({
          rowKey: `${prefix}:${kid.pid}`,
          depth,
          pid: kid.pid,
          query: kid.query ?? null,
          application: kid.app ?? null,
          fingerprint: kid.fingerprint ?? null,
          db_system: engine,
          db_instance: chain.database ?? null,
          waitingOnPid: node.pid,
          waitSeconds: kid.wait_seconds ?? null,
          blockingCount: below,
          // The middle of a chain — the row that makes a flat list lie, because
          // it is both a victim and a cause.
          kind: below > 0 ? "waiting-blocking" : "waiting",
          waitEventType: kid.wait_event_type ?? null,
          waitEvent: kid.wait_event ?? null,
          waitShare: scale(kid.wait_seconds),
          rails,
          isLast,
        });
        walk(kid, depth + 1, [...rails, !isLast], guard);
      });
    };

    if (root) walk(root, 1, [], new Set([root.pid]));
  }

  return rows;
};

/**
 * What a session is waiting on, in words a reader can act on.
 *
 * The raw event is the database's own vocabulary — `transactionid`, `tuple`,
 * `relation` — which says nothing to anyone who has not read the Postgres wait
 * event tables. Each maps to a different fix, so the distinction is worth
 * translating rather than flattening into one "a lock" for every row: waiting on
 * a `transactionid` means another transaction has to COMMIT before this one can
 * move, while waiting on a `relation` means someone took a table-level lock
 * (a DDL or an explicit LOCK TABLE).
 *
 * Returns the i18n key only — the caller resolves it, so this stays a pure
 * function testable without a vue-i18n instance. An event we have no sentence
 * for falls back to showing the raw name rather than guessing at its meaning.
 */
export const waitEventKey = (
  waitEvent: string | null | undefined,
  waitEventType: string | null | undefined,
): I18nKey | null => {
  const event = waitEvent?.trim().toLowerCase();
  if (event) {
    // Postgres `pg_stat_activity.wait_event` values under the `Lock` type.
    if (event === "transactionid" || event === "virtualxid")
      return "dbm.blocked.waitEvent.transaction";
    if (event === "tuple") return "dbm.blocked.waitEvent.row";
    if (event === "relation") return "dbm.blocked.waitEvent.table";
    if (event === "extend") return "dbm.blocked.waitEvent.extend";
    if (event === "advisory") return "dbm.blocked.waitEvent.advisory";
    if (event === "object" || event === "userlock") return "dbm.blocked.waitEvent.object";
    // A buffer wait is not a lock at all — it is IO contention, and calling it a
    // lock would send the reader looking for a transaction that does not exist.
    if (event.startsWith("buffer")) return "dbm.blocked.waitEvent.buffer";
    return null;
  }
  // No specific event, but the type still tells us it is lock contention.
  if (waitEventType?.trim().toLowerCase() === "lock") return "dbm.blocked.waitEvent.lock";
  return null;
};

/** Total seconds lost across every waiting session — the footer's cost line. */
export const totalWaitSeconds = (samples: BlockingSample[]): number =>
  samples.reduce((sum, s) => sum + (s.wait_seconds ?? 0), 0);

/** Distinct root blockers. One root behind everything is the headline. */
export const rootBlockerPids = (samples: BlockingSample[]): number[] => {
  const blockerByPid = new Map<number, number | null>();
  for (const s of samples) blockerByPid.set(s.blocked_pid, s.blocking_pid);
  const roots = new Set<number>();
  for (const s of samples) {
    const { rootPid } = resolveRoot(s.blocked_pid, blockerByPid);
    if (rootPid != null) roots.add(rootPid);
  }
  return [...roots];
};

/** Deepest chain in the set — "deepest 3" in the status bar. */
export const maxChainDepth = (samples: BlockingSample[]): number => {
  const blockerByPid = new Map<number, number | null>();
  for (const s of samples) blockerByPid.set(s.blocked_pid, s.blocking_pid);
  return samples.reduce(
    (max, s) => Math.max(max, resolveRoot(s.blocked_pid, blockerByPid).depth),
    0,
  );
};

/**
 * The statement that ends a session, as text to COPY — never to run.
 *
 * The mockup put an inline `End session <pid>` button here and we deliberately
 * did not build it. Two reasons. A destructive, irreversible action one click
 * away in a table that refreshes every 10 seconds is a footgun: the row under
 * the cursor can change identity between reading and clicking, and "I killed
 * the wrong session" has no undo. And executing it needs a privileged
 * write-path to the customer's database that this feature does not have —
 * shipping the button before the backend would mean a button that lies.
 *
 * Copyable SQL still beats naming the category. Given only a pid, the operator
 * retypes the statement from memory anyway. Handing them the exact
 * text, correct for their engine, removes the transcription error without
 * taking the decision away from the human at the psql prompt.
 */
export const terminateStatement = (dbSystem: string, pid: number | null | undefined): string => {
  if (pid == null) return "";
  const engine = dbSystem?.toLowerCase() ?? "";
  if (engine.includes("mysql") || engine.includes("maria")) return `KILL ${pid};`;
  if (engine.includes("postgres")) return `SELECT pg_terminate_backend(${pid});`;
  // An engine we have not special-cased: the Postgres form is the safer guess
  // for the PG-compatible databases (Aurora, Timescale, CockroachDB) that make
  // up the rest of what this receiver sees.
  return `SELECT pg_terminate_backend(${pid});`;
};

/**
 * A blocker sitting in an open transaction without running anything is the
 * "application forgot to commit" signature — the one blocking cause whose fix
 * is in code rather than in query tuning.
 *
 * A minute, not ten seconds. Ten fired a page-level amber banner on a perfectly
 * normal transaction that paused eleven seconds between statements — a request
 * waiting on an HTTP call mid-transaction does that routinely. Past a minute the
 * pause has stopped looking like work in progress and starts looking like a
 * transaction nobody is going to close.
 */
export const IDLE_BLOCKER_SECONDS = 60;

export const isIdleBlocker = (idleSeconds: number | null | undefined): boolean =>
  idleSeconds != null && idleSeconds >= IDLE_BLOCKER_SECONDS;

/**
 * Share-of-total-wait cutoffs that tone the wait bar. Red only near-total,
 * because a row owning most of the window's waiting IS the incident; amber from
 * a quarter, where the row is worth reading but not yet the whole story.
 */
export const WAIT_TONE_RULES = {
  critical: 0.9,
  warning: 0.25,
} as const;
