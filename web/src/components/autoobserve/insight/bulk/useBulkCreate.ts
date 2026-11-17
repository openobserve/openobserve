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

import { reactive, ref } from "vue";
import type { Router } from "vue-router";
import alertsService from "@/services/alerts";
import { toast, type DismissFn } from "@/lib/feedback/Toast/useToast";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { raw, type TranslateFn } from "@/types/i18n";
import { alertBodyFromPrefill } from "./bulkPayload";
import { skippedLine, toastOf, type FailureReason } from "./bulkCopy";
import { findExisting, loadExistingAlerts, type ExistingAlert } from "./existingAlerts";
import { refreshAfterAdd, serviceKeyOf, useRecentlyCreated } from "./useRecentlyCreated";
import { closeBulkReview, type BulkKind, type FolderRef, type ReviewRow } from "./useBulkReview";

// At most this many creates in flight, so a 400-row review never floods the alert API.
export const CONCURRENCY = 4;
export const CREATE_TIMEOUT_MS = 30_000;
const DUPLICATE_RX = /already exists|duplicate|unique/i;
const RETRYABLE_STATUS = new Set([408, 500, 502, 503, 504]);

export type RowStatus = "queued" | "creating" | "created" | "failed" | "exists";

export interface RowResult {
  status: RowStatus;
  reason?: FailureReason;
  retryable?: boolean;
  id?: string;
}

interface Job {
  key: string;
  kind: BulkKind;
  prefill: AlertPrefill;
  folder: FolderRef;
  destinations: string[];
  serviceKey: string;
}

interface Created {
  key: string;
  kind: BulkKind;
  id: string;
  folder: FolderRef;
  serviceKey: string;
}

/** The alerts created on this page in one org since the last Undo; only its own Undo may delete them. */
interface Session {
  org: string;
  created: Created[];
  toast: DismissFn | null;
  stopRoute: (() => void) | null;
  undoable: boolean;
  /** Set once no further create may start: Undo, the review going away, or an org switch. */
  cancelled: boolean;
  inflight: Promise<void>;
  announced: number;
  /** Rows Add left out because the org already had their alert when it re-checked. */
  skipped: number;
}

export interface BulkCreateDeps {
  org: () => string;
  store: any;
  router: Router;
  t: TranslateFn;
  locale: () => string;
  floorMinutes: () => number;
}

/** Runs `worker` over `items` with at most `limit` running at once, in order of `items`. */
export const runPool = async <T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> => {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await worker(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
};

/** Maps a failed create to the reason a row shows and whether Retry may re-send it. */
export const failureOf = (
  err: any,
  job: { folder: FolderRef; name: string },
): { reason: FailureReason; retryable: boolean } => {
  const status: number | undefined = err?.response?.status;
  const body = err?.response?.data;
  const message = String(body?.message ?? body?.error ?? (typeof body === "string" ? body : ""));
  if (status === 403)
    return { reason: { code: "forbidden", folder: job.folder.name }, retryable: false };
  if (status === 409 || DUPLICATE_RX.test(message)) {
    return {
      reason: { code: "duplicate", name: job.name, folder: job.folder.name },
      retryable: false,
    };
  }
  const timedOut =
    !err?.response ||
    err?.code === "ECONNABORTED" ||
    err?.code === "ETIMEDOUT" ||
    status === 408 ||
    status === 504;
  if (timedOut) return { reason: { code: "timeout" }, retryable: true };
  if (status === 400) return { reason: { code: "invalid" }, retryable: false };
  if (status === 404) return { reason: { code: "missing" }, retryable: false };
  return { reason: { code: "server" }, retryable: RETRYABLE_STATUS.has(status ?? 0) };
};

export const useBulkCreate = (deps: BulkCreateDeps) => {
  const results = reactive<Record<string, RowResult>>({});
  const running = ref(false);
  const jobs = new Map<string, Job>();
  const recently = useRecentlyCreated();
  let session: Session | null = null;

  const newSession = (org: string): Session => ({
    org,
    created: [],
    toast: null,
    stopRoute: null,
    undoable: true,
    cancelled: false,
    inflight: Promise.resolve(),
    announced: 0,
    skipped: 0,
  });

  /** Takes Undo away; the alerts stay. */
  const closeUndo = (s: Session): void => {
    s.undoable = false;
    s.stopRoute?.();
    s.stopRoute = null;
    const dismiss = s.toast;
    s.toast = null;
    dismiss?.();
  };

  /** Starts no further create for this session and takes Undo away. */
  const stop = (s: Session): void => {
    s.cancelled = true;
    closeUndo(s);
  };

  // Every write goes to the org the user reviewed in; after a switch nothing more is sent.
  const mayWrite = (s: Session): boolean => {
    if (deps.org() !== s.org) s.cancelled = true;
    return !s.cancelled;
  };

  const runJob = async (s: Session, job: Job): Promise<void> => {
    if (!mayWrite(s)) {
      delete results[job.key];
      return;
    }
    results[job.key] = { status: "creating" };
    try {
      const body = await alertBodyFromPrefill(job.prefill, {
        store: deps.store,
        folderId: job.folder.id,
        destinations: job.destinations,
        floorMinutes: deps.floorMinutes(),
      });
      // Building the payload awaits, so the org, the review or an Undo may have changed meanwhile.
      if (!mayWrite(s)) {
        delete results[job.key];
        return;
      }
      const res = await alertsService.create_by_alert_id(s.org, body, job.folder.id, {
        silentForbidden: true,
        timeout: CREATE_TIMEOUT_MS,
      });
      const id = String(res?.data?.id ?? "");
      results[job.key] = { status: "created", id };
      if (id) s.created.push({ ...job, id });
      recently.add(job.serviceKey, job.kind);
    } catch (err) {
      const failure = failureOf(err, { folder: job.folder, name: job.prefill.name ?? "" });
      results[job.key] = { status: "failed", ...failure };
    }
  };

  const undo = async (s: Session): Promise<void> => {
    if (!s.undoable) return;
    // Undo stops what is queued and waits for what is in flight, so it also deletes the ids those return.
    s.cancelled = true;
    closeUndo(s);
    await s.inflight;
    const items = s.created.splice(0);
    let failed = 0;
    await runPool(items, CONCURRENCY, async (item) => {
      try {
        await alertsService.delete_by_alert_id(s.org, item.id, item.folder.id, {
          silentForbidden: true,
        });
        recently.remove(item.serviceKey, item.kind);
        delete results[item.key];
      } catch {
        failed += 1;
      }
    });
    refreshAfterAdd(s.org);
    const { t } = deps;
    toast(
      failed
        ? {
            variant: "error",
            message: t("insight.bulk.undoFailed", { failed, total: items.length }),
          }
        : {
            variant: "success",
            message: t("insight.bulk.undone", { count: items.length }, items.length),
          },
    );
  };

  // One toast holds every batch of the session, since equal toasts collapse and keep the first handler.
  const announce = (s: Session): void => {
    if (s.skipped && s.created.length === s.announced) {
      toast({ variant: "default", message: skippedLine(deps.t, s.skipped) });
      // Said once: closing the review re-announces, and this toast carries no Undo to bring back.
      s.skipped = 0;
      return;
    }
    if (!s.undoable || s.created.length === s.announced) return;
    s.announced = s.created.length;
    const folders = [...new Map(s.created.map((c) => [c.folder.id, c.folder])).values()];
    const previous = s.toast;
    s.toast = null;
    previous?.();
    const created = toastOf(deps.t, deps.locale(), folders, s.created.length);
    const shown = toast({
      variant: "default",
      message: s.skipped ? raw(`${created} ${skippedLine(deps.t, s.skipped)}`) : created,
      timeout: 0,
      action: { label: deps.t("insight.bulk.undo"), handler: () => void undo(s) },
      // A closed toast takes Undo with it, so its ids are never deleted later.
      onDismiss: () => s.toast?.id === shown.id && closeUndo(s),
    });
    s.toast = shown;
    s.stopRoute ??= deps.router.afterEach((to, from) => {
      if (to.path !== from.path) closeUndo(s);
    });
  };

  const run = async (s: Session, list: Job[]): Promise<void> => {
    running.value = true;
    for (const job of list) results[job.key] = { status: "queued" };
    const pool = runPool(list, CONCURRENCY, (job) => runJob(s, job));
    s.inflight = pool;
    try {
      await pool;
    } finally {
      running.value = false;
    }
    announce(s);
    if (s.created.length || s.skipped) refreshAfterAdd(s.org);
    if (Object.values(results).every((r) => r.status === "created" || r.status === "exists")) {
      closeBulkReview();
    }
  };

  // Another tab or user may have added some of these since the review opened; an unread list skips nothing.
  const skipExisting = async (s: Session, list: Job[]): Promise<Job[]> => {
    const known: ExistingAlert[] | null = await loadExistingAlerts(s.org).catch(() => null);
    if (!known) return list;
    return list.filter((job) => {
      const found = findExisting(known, {
        name: job.prefill.name ?? "",
        folderId: job.folder.id,
        streamType: job.prefill.streamType,
        streamName: job.prefill.streamName,
        sql: job.prefill.sql ?? null,
      });
      if (!found) return true;
      results[job.key] = { status: "exists", id: found.id };
      recently.add(job.serviceKey, job.kind);
      s.skipped += 1;
      return false;
    });
  };

  // A failed or timed-out POST may still have created its alert, so Retry re-checks the same way Add does.
  const checkThenRun = async (s: Session, list: Job[]): Promise<void> => {
    s.skipped = 0;
    running.value = true;
    for (const job of list) results[job.key] = { status: "queued" };
    let fresh: Job[];
    try {
      fresh = await skipExisting(s, list);
    } finally {
      running.value = false;
    }
    if (!mayWrite(s)) {
      for (const job of fresh) delete results[job.key];
      return;
    }
    await run(s, fresh);
  };

  /** Creates exactly the given rows, one POST each, in the org the review shows. */
  const create = async (kind: BulkKind, rows: ReviewRow[]): Promise<void> => {
    if (running.value) return;
    const org = deps.org();
    if (!session || !session.undoable || session.cancelled || session.org !== org) {
      if (session) stop(session);
      session = newSession(org);
    }
    for (const key of Object.keys(results)) delete results[key];
    jobs.clear();
    const list: Job[] = rows.flatMap((row) =>
      row.prefill
        ? [
            {
              key: row.key,
              // One service's review mixes kinds, and the just-added store is keyed by each row's own.
              kind: row.row.kind ?? kind,
              prefill: row.prefill,
              folder: row.folder,
              destinations: row.destinations,
              serviceKey: serviceKeyOf(org, row.service, row.cluster, row.namespace),
            },
          ]
        : [],
    );
    for (const job of list) jobs.set(job.key, job);
    await checkThenRun(session, list);
  };

  /** Re-sends only failed rows a retry can help and the org still lacks, in the batch's org; a created row is never sent twice. */
  const retry = async (keys: string[]): Promise<void> => {
    if (running.value || !session || deps.org() !== session.org) return;
    const list = keys
      .filter((key) => results[key]?.status === "failed" && results[key]?.retryable)
      .flatMap((key) => (jobs.has(key) ? [jobs.get(key)!] : []));
    if (list.length === 0) return;
    if (!session.undoable || session.cancelled) session = newSession(session.org);
    await checkThenRun(session, list);
  };

  /** Hides the Undo toast while a new review covers its place; Undo itself stays valid. */
  const hideUndo = (): void => {
    const s = session;
    if (!s?.toast) return;
    const dismiss = s.toast;
    s.toast = null;
    s.announced = 0;
    dismiss();
  };

  /** Shows the Undo toast again once the review that hid it closes. */
  const showUndo = (): void => {
    if (session && !running.value) announce(session);
  };

  /** Clears the per-row results when the review opens again. */
  const reset = (): void => {
    if (running.value) return;
    for (const key of Object.keys(results)) delete results[key];
    jobs.clear();
  };

  return {
    results,
    running,
    create,
    retry,
    reset,
    hideUndo,
    showUndo,
    undo: () => (session ? undo(session) : Promise.resolve()),
    /** The review went away or the org changed: nothing more is sent and Undo closes. */
    expire: () => session && stop(session),
  };
};
