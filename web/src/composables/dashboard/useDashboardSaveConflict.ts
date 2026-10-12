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
  fetchLatestDashboard,
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
  mine: any;
  base: LoadedDashboardVersion | null;
  latest: { data: any; hash: string; updatedAt: number | null } | null;
  merged: any | null;
}

let session: ConflictSession | null = null;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(toRaw(value) ?? null));

const localeOf = (ctx: ConflictContext) => unref(ctx.locale) || "en-US";

const orgOf = (ctx: ConflictContext) => ctx.store.state.selectedOrganization.identifier;

const conflictMessage = (error: any) => raw(error?.response?.data?.message ?? error?.message ?? "");

export const isDashboardConflictError = (error: any) => error?.response?.status === 409;

const recompute = (s: ConflictSession) => {
  const latest = s.latest?.data;
  const diff = s.base ? diffDashboards(s.base.snapshot, latest) : null;
  state.hasBase = !!diff;
  state.changes = diff?.changes ?? [];
  state.changedSettings = diff?.changedSettings ?? [];
  state.latestUpdatedAt = toEpochMs(s.latest?.updatedAt);
  state.panelTouched = isPanelTouched(state.changes, s.request.panelId);
  state.panelComparison = state.panelTouched
    ? comparePanel(latest, s.mine, s.request.panelId)
    : null;
};

const loadLatest = async (s: ConflictSession) => {
  try {
    const latest = await fetchLatestDashboard(
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
  await s.request.onResolved?.(outcome);
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
  const cached = ctx.store.state.organizationData.allDashboardData?.[request.dashboardId];
  const mineSource = request.mine ?? cached;
  const unresolved = getUnresolvedDashboardConflict(request.dashboardId);
  const base = unresolved ?? getLoadedDashboardVersion(request.dashboardId);
  setUnresolvedDashboardConflict(request.dashboardId, base);
  state.unresolvedDashboardId = String(request.dashboardId);
  markDashboardStale(mineSource, base?.hash);
  markDashboardStale(cached, base?.hash);

  const s: ConflictSession = {
    request,
    ctx,
    mine: clone(mineSource),
    base,
    latest: null,
    merged: null,
  };
  session = s;
  Object.assign(state, {
    mounted: true,
    open: true,
    step: "loading",
    busy: null,
    notice: unresolved ? "stillUnresolved" : null,
    errorMessage: "",
    myChange: request.change ?? "",
    dashboardId: String(request.dashboardId),
    isPanelEditor: !!request.panelId,
    panelTouched: false,
    hasBase: !!base,
    hasMine: !!s.mine,
    latestUpdatedAt: null,
    changes: [],
    changedSettings: [],
    panelComparison: null,
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
    await finish(s, "reloaded");
    toast({
      variant: "success",
      message: s.request.change
        ? s.ctx.t("dashboard.saveConflict.toastReloadedChange", { change: s.request.change })
        : s.ctx.t("dashboard.saveConflict.toastReloaded"),
    });
  });

const confirmOverwrite = () =>
  runAction("overwrite", async (s) => {
    if (s.mine) await saveAgainstLatest(s, clone(s.mine), "overwritten");
  });

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
    s.mine,
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

const reopen = () => {
  if (!session) return;
  if (state.step !== "loading" && state.step !== "error") setStep("main");
  state.open = true;
};

/** Actions for the shared dialog; state lives in `dashboardSaveConflictState`. */
export const useDashboardSaveConflictDialog = () => ({
  state,
  reload,
  startOverwrite: () => setStep("confirm"),
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
