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

import { markRaw, shallowReactive } from "vue";

import { streamTypeOf } from "@/utils/assistant/explorerRoutes";

import type { Sid } from "../../assistantStore.types";
import { MAX_RESULT_ROWS, boundedRow } from "../../evidence";
import { registerApplier, type ActionEnv, type Applier } from "../registry";
import type { AssistantAction } from "../types";

/** A Run inline as the block shows it; kept in memory only, never in the record. */
export interface QueryRun {
  status: "running" | "done" | "empty" | "failed" | "forbidden" | "stopped";
  startedAt: number;
  /** The window that ran, epoch ms; capped and defaulted, so it can differ from the block's. */
  window?: { from: number; to: number; fallback: boolean; capped: boolean };
  rows?: Record<string, string>[];
  columns?: string[];
  total?: number;
  tookMs?: number;
  scannedBytes?: number;
  /** The server's reason, bounded; shown as text. */
  reason?: string;
}

// An unknown range runs on the last 15 minutes and a model's range is cut to 7 days, never all time.
const DEFAULT_WINDOW_MS = 15 * 60_000;

const MAX_WINDOW_MS = 7 * 24 * 3_600_000;

const MAX_REASON_CHARS = 300;

const runs = /* @__PURE__ */ shallowReactive(new Map<string, QueryRun>());

const controllers = new Map<string, AbortController>();

/** Run inline through the search API with the user's own permissions; no agent call, no credit. */
export const runQueryApplier: Applier<Extract<AssistantAction, { kind: "run_query" }>> = async (
  sid,
  action,
  env,
) => {
  const session = env.store().state.sessions[sid];
  const key = runKey(sid, action.blockId);
  if (!session || action.query.language !== "sql") return { ok: false, reason: "failed" };
  const startedAt = env.now();
  controllers.get(key)?.abort();
  const controller = new AbortController();
  controllers.set(key, controller);
  const window = windowOf(action.query.from, action.query.to, startedAt);
  setRun(env, sid, action.blockId, { status: "running", startedAt, window });
  try {
    const data = await env.search({
      org: session.org,
      sql: action.query.text,
      startTime: window.from * 1000,
      endTime: window.to * 1000,
      streamType: streamTypeOf(action.query.streamType) ?? "logs",
      size: MAX_RESULT_ROWS,
      signal: controller.signal,
    });
    if (controllers.get(key) !== controller) return { ok: false, reason: "failed" };
    return settle(env, sid, action.blockId, { ...resultOf(data, startedAt), window });
  } catch (error) {
    if (controllers.get(key) !== controller) return { ok: false, reason: "failed" };
    const failure = failureOf(error, controller.signal, startedAt);
    return settle(env, sid, action.blockId, { ...failure, window });
  } finally {
    if (controllers.get(key) === controller) controllers.delete(key);
  }
};

export const stopQueryApplier: Applier<Extract<AssistantAction, { kind: "stop_query" }>> = (
  sid,
  action,
) => {
  const controller = controllers.get(runKey(sid, action.blockId));
  if (!controller) return { ok: false, reason: "failed" };
  controller.abort();
  return { ok: true };
};

/** The block's run, reactive; null before the first Run. */
export function queryRunOf(sid: Sid, blockId: string): QueryRun | null {
  return runs.get(runKey(sid, blockId)) ?? null;
}

/** Aborts and forgets the runs of every session not in `keep`: a closed, deleted or other-org chat keeps no rows. */
export function pruneQueryRuns(keep: ReadonlySet<Sid>): void {
  for (const key of [...runs.keys(), ...controllers.keys()]) {
    if (keep.has(key.split("\u0000")[0])) continue;
    controllers.get(key)?.abort();
    controllers.delete(key);
    runs.delete(key);
  }
}

function windowOf(from: number | undefined, to: number | undefined, now: number) {
  const end = to ?? now;
  const fallback = from === undefined || to === undefined || from >= to;
  const start = fallback ? end - DEFAULT_WINDOW_MS : from;
  const capped = end - start > MAX_WINDOW_MS;
  return { from: capped ? end - MAX_WINDOW_MS : start, to: end, fallback, capped };
}

function settle(env: ActionEnv, sid: Sid, blockId: string, run: QueryRun) {
  setRun(env, sid, blockId, run);
  const ok = run.status === "done" || run.status === "empty";
  return ok
    ? { ok: true as const, detail: run }
    : { ok: false as const, reason: "failed" as const };
}

// The annotation keeps the state across a container move; the rows stay in memory.
function setRun(env: ActionEnv, sid: Sid, blockId: string, run: QueryRun): void {
  runs.set(runKey(sid, blockId), markRaw(run));
  const status =
    run.status === "running" || run.status === "stopped"
      ? run.status
      : run.status === "done" || run.status === "empty"
        ? "done"
        : "failed";
  env.store().annotate(sid, blockId, {
    run: { status, startedAt: run.startedAt, ...(run.total !== undefined && { rows: run.total }) },
  });
}

function resultOf(data: Record<string, unknown>, startedAt: number): QueryRun {
  const hits = Array.isArray(data.hits) ? data.hits.slice(0, MAX_RESULT_ROWS).map(boundedRow) : [];
  const total = typeof data.total === "number" ? data.total : hits.length;
  const columns = Array.from(new Set(hits.flatMap((row) => Object.keys(row)))).slice(0, 20);
  const took = typeof data.took === "number" ? data.took : undefined;
  const scanned = typeof data.scan_size === "number" ? data.scan_size * 1024 * 1024 : undefined;
  return {
    status: hits.length === 0 ? "empty" : "done",
    startedAt,
    rows: hits,
    columns,
    total,
    ...(took !== undefined && { tookMs: took }),
    ...(scanned !== undefined && { scannedBytes: scanned }),
  };
}

function failureOf(error: unknown, signal: AbortSignal, startedAt: number): QueryRun {
  if (signal.aborted) return { status: "stopped", startedAt };
  const response = (error as { response?: { status?: number; data?: Record<string, unknown> } })
    ?.response;
  if (response?.status === 403) return { status: "forbidden", startedAt };
  const data = response?.data ?? {};
  const raw = data.message ?? data.error ?? (error as { message?: unknown })?.message;
  const reason = typeof raw === "string" ? raw.slice(0, MAX_REASON_CHARS) : undefined;
  return { status: "failed", startedAt, ...(reason && { reason }) };
}

function runKey(sid: Sid, blockId: string): string {
  return `${sid}\u0000${blockId}`;
}

export function registerQueryAppliers(): void {
  registerApplier("run_query", runQueryApplier);
  registerApplier("stop_query", stopQueryApplier);
}
