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

import { toRaw, unref, watch, type Ref } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText, type TranslateFn } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  adoptDashboardWorkingCopy,
  fetchLatestDashboard,
  fetchServerDashboard,
  getLoadedDashboardVersion,
  getUnresolvedDashboardConflict,
  markDashboardStale,
  setUnresolvedDashboardConflict,
  updateDashboard,
  type LoadedDashboardVersion,
} from "@/utils/commons";
import {
  comparePanel,
  diffDashboards,
  formatClockTime,
  isPanelTouched,
  mergePanelOntoLatest,
  overwriteImpact,
  toEpochMs,
} from "@/utils/dashboard/saveConflict";
import {
  dashboardSaveConflictState as state,
  type ConflictAction,
  type ConflictOutcome,
  type MergedPanelRow,
} from "./dashboardSaveConflictState";

export interface DashboardConflictRequest {
  dashboardId: string;
  folderId: string;
  /** The dashboard I tried to save; defaults to the cached copy the save helpers edit in place. */
  mine?: any;
  /** Panel editor only: the edited panel, which enables Merge. */
  panelId?: string;
  /** What I tried to save, shown in the dialog and named when Reload discards it. */
  change?: I18nText;
  onResolved?: (outcome: ConflictOutcome) => void | Promise<void>;
}

interface ConflictContext {
  store: any;
  t: TranslateFn;
  locale: Ref<string> | string;
}

interface ConflictSession {
  request: DashboardConflictRequest;
  ctx: ConflictContext;
  /** Every change that lost a conflict since the dashboard was loaded, oldest first. */
  changes: I18nText[];
  onResolved: NonNullable<DashboardConflictRequest["onResolved"]>[];
  mine: any;
  base: LoadedDashboardVersion | null;
  /** The server's version and hash; the cache keeps the user's working copy until Reload. */
  latest: { data: any; hash: string; updatedAt: number | null } | null;
  merged: any | null;
}

const RELOAD_TOAST_MS = 15_000;

let session: ConflictSession | null = null;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(toRaw(value) ?? null));

const localeOf = (ctx: ConflictContext) => unref(ctx.locale) || "en-US";

const orgOf = (ctx: ConflictContext) => ctx.store.state.selectedOrganization.identifier;

const conflictMessage = (error: any) => raw(error?.response?.data?.message ?? error?.message ?? "");

export const isDashboardConflictError = (error: any) => error?.response?.status === 409;

// The cached dashboard is the working copy: my loaded version plus every pending edit, and what Overwrite saves.
const workingCopy = (s: ConflictSession) =>
  s.ctx.store.state.organizationData.allDashboardData?.[s.request.dashboardId] ?? s.mine;

const changesText = (s: ConflictSession) =>
  new Intl.ListFormat(localeOf(s.ctx), { style: "long", type: "conjunction" }).format(s.changes);

const recompute = (s: ConflictSession) => {
  const latest = s.latest?.data;
  const diff = s.base ? diffDashboards(s.base.snapshot, latest) : null;
  state.hasBase = !!diff;
  state.changes = diff?.changes ?? [];
  state.changedSettings = diff?.changedSettings ?? [];
  state.latestUpdatedAt = toEpochMs(s.latest?.updatedAt);
  state.panelTouched = isPanelTouched(state.changes, s.request.panelId);
  state.panelComparison = state.panelTouched
    ? comparePanel(latest, workingCopy(s), s.request.panelId)
    : null;
};

const loadLatest = async (s: ConflictSession) => {
  try {
    const latest = await fetchServerDashboard(
      s.ctx.store,
      s.request.dashboardId,
      s.request.folderId,
    );
    if (session !== s) return;
    s.latest = { data: clone(latest.data), hash: latest.hash, updatedAt: latest.updatedAt };
    recompute(s);
    state.step = "main";
  } catch (error: any) {
    if (session !== s) return;
    state.errorMessage = conflictMessage(error);
    state.step = "error";
  }
};

const signalResolved = (dashboardId: string, outcome: ConflictOutcome) => {
  state.resolvedDashboardId = dashboardId;
  state.resolvedOutcome = outcome;
  state.resolvedSeq += 1;
};

const finish = async (s: ConflictSession, outcome: ConflictOutcome) => {
  setUnresolvedDashboardConflict(s.request.dashboardId, null);
  for (const callback of s.onResolved) await callback(outcome);
  signalResolved(s.request.dashboardId, outcome);
  state.open = false;
  session = null;
};

const runAction = async (action: ConflictAction, fn: (s: ConflictSession) => Promise<void>) => {
  const s = session;
  if (!s || state.busy) return;
  state.busy = action;
  state.notice = null;
  try {
    await fn(s);
  } finally {
    state.busy = null;
  }
};

/** Opens the shared conflict dialog for a dashboard save that failed with 409. */
export const openDashboardConflict = async (
  request: DashboardConflictRequest,
  ctx: ConflictContext,
) => {
  const id = request.dashboardId;
  // A save made from its own copy (settings forms, the JSON editor) becomes the working copy, so later edits stack on it.
  if (request.mine) adoptDashboardWorkingCopy(ctx.store, id, request.mine);
  const cached = ctx.store.state.organizationData.allDashboardData?.[id];
  const mineSource = cached ?? request.mine;
  const unresolved = getUnresolvedDashboardConflict(id);
  const base = unresolved ?? getLoadedDashboardVersion(id);
  setUnresolvedDashboardConflict(id, base);
  state.unresolvedDashboardId = String(id);
  markDashboardStale(request.mine, base?.hash);
  markDashboardStale(cached, base?.hash);

  // A further conflict before the first is resolved adds to the same session instead of dropping its pending edits.
  const extend = !!unresolved && session?.request.dashboardId === id ? session : null;
  const s: ConflictSession = extend ?? {
    request,
    ctx,
    changes: [],
    onResolved: [],
    mine: null,
    base,
    latest: null,
    merged: null,
  };
  s.request = request;
  s.ctx = ctx;
  s.mine = clone(mineSource);
  s.merged = null;
  if (request.change && !s.changes.includes(request.change)) s.changes.push(request.change);
  if (request.onResolved) s.onResolved.push(request.onResolved);
  session = s;
  Object.assign(state, {
    mounted: true,
    openSeq: state.openSeq + 1,
    open: true,
    step: "loading",
    busy: null,
    notice: unresolved ? "stillUnresolved" : null,
    errorMessage: "",
    myChange: changesText(s),
    myChangeCount: s.changes.length,
    dashboardId: String(id),
    isPanelEditor: !!request.panelId,
    panelTouched: false,
    hasBase: !!base,
    hasMine: !!s.mine,
    latestUpdatedAt: null,
    changes: [],
    changedSettings: [],
    panelComparison: null,
    impact: null,
    mergedRows: [],
    mergeUnavailable: false,
  });
  await loadLatest(s);
};

const saveAgainstLatest = async (s: ConflictSession, doc: any, outcome: ConflictOutcome) => {
  const { store, t } = s.ctx;
  const savedAt = state.latestUpdatedAt;
  try {
    await updateDashboard(
      store,
      orgOf(s.ctx),
      s.request.dashboardId,
      doc,
      s.request.folderId,
      s.latest?.hash,
    );
  } catch (error: any) {
    if (isDashboardConflictError(error)) {
      state.notice = "savedAgain";
      state.step = "loading";
      await loadLatest(s);
      return;
    }
    state.errorMessage = conflictMessage(error);
    state.notice = "saveFailed";
    return;
  }
  await finish(s, outcome);
  if (outcome === "merged")
    toast({ variant: "success", message: t("dashboard.saveConflict.toastMerged") });
  else if (savedAt)
    toast({
      variant: "success",
      message: t("dashboard.saveConflict.toastOverwritten", {
        time: formatClockTime(savedAt, localeOf(s.ctx)),
      }),
    });
  else toast({ variant: "success", message: t("dashboard.saveConflict.toastOverwrittenNoTime") });
};

const reload = () =>
  runAction("reload", async (s) => {
    try {
      await fetchLatestDashboard(s.ctx.store, s.request.dashboardId, s.request.folderId);
    } catch (error: any) {
      state.errorMessage = conflictMessage(error);
      state.notice = "saveFailed";
      return;
    }
    const discarded = changesText(s);
    // Shown before the sites react (the panel editor navigates away), and kept longer than a routine success: it reports lost work.
    toast({
      variant: "success",
      timeout: RELOAD_TOAST_MS,
      message: discarded
        ? s.ctx.t("dashboard.saveConflict.toastReloadedChange", { change: discarded })
        : s.ctx.t("dashboard.saveConflict.toastReloaded"),
    });
    await finish(s, "reloaded");
  });

const confirmOverwrite = () =>
  runAction("overwrite", async (s) => {
    const mine = workingCopy(s);
    if (mine) await saveAgainstLatest(s, clone(mine), "overwritten");
  });

// The confirm lists what saving the working copy undoes of the server's version, as it stands right now.
const startOverwrite = () => {
  const s = session;
  setStep("confirm");
  if (!s?.latest) return;
  state.impact = overwriteImpact(s.base?.snapshot ?? null, s.latest.data, clone(workingCopy(s)));
};

const mergedRowsFor = (s: ConflictSession, merged: any): MergedPanelRow[] => {
  const added = new Set(
    state.changes.filter((c) => c.kind === "panel" && c.change === "added").map((c) => c.key),
  );
  const edited = new Set(
    state.changes.filter((c) => c.kind === "panel" && c.change === "changed").map((c) => c.key),
  );
  const rows: MergedPanelRow[] = [];
  for (const tab of merged?.tabs ?? []) {
    for (const panel of tab?.panels ?? []) {
      const key = String(panel?.id);
      const tag =
        key === String(s.request.panelId)
          ? "yours"
          : added.has(key)
            ? "theirsNew"
            : edited.has(key)
              ? "theirsEdited"
              : null;
      rows.push({ key, name: panel?.title || key, tag });
    }
  }
  return rows;
};

const merge = () => {
  const s = session;
  // Merging would silently replace their edit of the same panel, so that case only offers Reload or Overwrite.
  if (!s?.latest || !s.request.panelId || state.panelTouched) return;
  const merged = mergePanelOntoLatest(
    s.latest.data,
    clone(workingCopy(s)),
    s.request.panelId,
    s.base?.snapshot ?? s.latest.data,
  );
  state.mergeUnavailable = !merged;
  if (!merged) return;
  s.merged = merged;
  state.mergedRows = mergedRowsFor(s, merged);
  state.step = "review";
};

const saveMerged = () =>
  runAction("saveMerged", async (s) => {
    if (s.merged) await saveAgainstLatest(s, s.merged, "merged");
  });

const discardMerge = () => {
  const s = session;
  state.open = false;
  if (s) {
    s.merged = null;
    toast({ variant: "info", message: s.ctx.t("dashboard.saveConflict.toastMergeDiscarded") });
  }
};

const retry = async () => {
  const s = session;
  if (!s) return;
  state.step = "loading";
  await loadLatest(s);
};

const setStep = (step: "main" | "confirm") => {
  state.notice = null;
  state.mergeUnavailable = false;
  state.step = step;
};

const close = () => {
  if (state.busy) return;
  state.open = false;
};

// Reopening is not a save attempt, so it never carries a save notice; it re-reads the working copy as it is now.
const reopen = () => {
  const s = session;
  if (!s) return;
  if (state.step !== "loading" && state.step !== "error") setStep("main");
  state.notice = null;
  s.mine = clone(workingCopy(s));
  if (s.latest) recompute(s);
  state.openSeq += 1;
  state.open = true;
};

/** Actions for the shared dialog; state lives in `dashboardSaveConflictState`. */
export const useDashboardSaveConflictDialog = () => ({
  state,
  reload,
  startOverwrite,
  confirmOverwrite,
  merge,
  saveMerged,
  discardMerge,
  back: () => setStep("main"),
  retry,
  close,
  reopen,
});

let dialogPreload: Promise<unknown> | null = null;

/** For dashboard save sites: replaces the old "Refresh" toast on a 409. */
export const useDashboardSaveConflict = () => {
  // Fetch the lazily mounted dialog ahead of time so it opens the moment a save conflicts.
  dialogPreload ??= import("@/components/dashboards/DashboardSaveConflictDialog.vue").catch(
    () => (dialogPreload = null),
  );
  const store = useStore();
  const { t, locale } = useI18nTyped();
  return {
    isConflict: isDashboardConflictError,
    openConflict: (request: DashboardConflictRequest) =>
      openDashboardConflict(request, { store, t, locale }),
  };
};

/** Re-renders a view after the conflict dialog reloaded, overwrote or merged its dashboard. */
export const onDashboardConflictResolved = (
  callback: (dashboardId: string, outcome: ConflictOutcome) => void,
) =>
  watch(
    () => state.resolvedSeq,
    () => {
      if (state.resolvedOutcome) callback(state.resolvedDashboardId, state.resolvedOutcome);
    },
  );
