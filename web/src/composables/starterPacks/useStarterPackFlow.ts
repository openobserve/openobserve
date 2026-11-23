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

import { computed, onScopeDispose, ref, shallowRef } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { useStore } from "vuex";

import { readQuery } from "@/composables/query/readQuery";
import { refreshOrgResources } from "@/composables/useOrgResources";
import { alertsByTagsQuery } from "@/services/alerts.queries";
import { featureState } from "@/utils/featureGate";

import {
  StarterPackBusyError,
  StarterPackPermissionError,
  leftOutIds,
  type PackChoices,
  type PackInstallRecord,
  type PackPreview,
  type PackRecordItem,
  type PackRemovalResult,
  type StarterPack,
} from "./types";
import { adaptSavedView } from "./packAdapt";
import { RESERVED_FIELD } from "./packBinding";
import { useBrowserMatches } from "./useBrowserMatches";
import { useStarterPacks } from "./useStarterPacks";

export const UNDO_WINDOW_US = 24 * 60 * 60 * 1_000_000;

const CLOCK_TICK_MS = 60_000;

export type PackPreviewState = "idle" | "loading" | "ready" | "error" | "forbidden";

/** What the user changed in the plan before setup. */
export interface PackInstallChoice {
  /** Item ids the user unticked, on top of the ones the preview leaves out. */
  exclude?: string[];
  enableAlerts?: boolean;
  /** Alert destination the created alerts route to, whether they start on or off. */
  destination?: string;
}

const isForbidden = (error: any): boolean => error?.response?.status === 403;

const countsAsItem = (item: PackRecordItem) => item.kind !== "folder";
const notSkipped = (item: PackRecordItem) => item.status !== "skipped";

export const isOrgAdmin = (state: Record<string, any>): boolean => {
  const role = String(state.userInfo?.role ?? state.currentuser?.role ?? "").toLowerCase();
  return state.zoConfig?.is_org_admin === true || role === "admin" || role === "root";
};

/** Admins and whoever set the pack up may change what it installed. */
export const canManageInstall = (state: Record<string, any>, record: PackInstallRecord | null) =>
  isOrgAdmin(state) || (!!record?.installedBy && record.installedBy === state.userInfo?.email);

const newestRecord = (rows: PackInstallRecord[]): PackInstallRecord | null => {
  const live = rows.filter((row) => row.status !== "removed");
  const unfinished = live.find((row) => row.status !== "complete");
  if (unfinished) return unfinished;
  return [...live].sort((a, b) => (b.installedAt ?? 0) - (a.installedAt ?? 0))[0] ?? null;
};

/** One surface's view of a pack: its install, its preview, and the actions on both. */
export function useStarterPackFlow(org: string, pack: StarterPack) {
  const store = useStore();
  const router = useRouter();
  const { installPack, previewPack, undoPack, removePack, listInstalls } = useStarterPacks(org);

  const record = shallowRef<PackInstallRecord | null>(null);
  const loaded = ref(false);
  const loadFailed = ref(false);
  const running = ref(false);
  const busy = ref(false);
  const installFailed = ref(false);
  const forbidden = ref(false);
  /** Who started the setup that is already running, or "" when its record names no one. */
  const busyBy = ref<string | null>(null);
  const preview = shallowRef<PackPreview | null>(null);
  const previewState = ref<PackPreviewState>("idle");
  const removal = shallowRef<PackRemovalResult | null>(null);
  const removalFailed = ref(false);
  const alertsOn = ref(0);
  const enabledAlertIds = shallowRef<Set<string>>(new Set());
  let previewRun = 0;
  const choices = ref<PackChoices>({ streams: {}, fields: {} });
  const nowUs = ref(Date.now() * 1000);
  const clock = setInterval(() => (nowUs.value = Date.now() * 1000), CLOCK_TICK_MS);
  onScopeDispose(() => clearInterval(clock));

  const licensed = computed(
    () =>
      !!pack.nativeView &&
      featureState(store.state.zoConfig?.features, pack.nativeView.feature) === "enabled",
  );

  // A failed folder stops the run, so what it left pending failed with it and Retry redoes both.
  const items = computed(() => {
    const all = record.value?.items ?? [];
    const blocked =
      !running.value && all.some((item) => !countsAsItem(item) && item.status === "failed");
    return all
      .filter(countsAsItem)
      .map((item) =>
        blocked && item.status === "pending" ? { ...item, status: "failed" as const } : item,
      );
  });
  const made = computed(() => items.value.filter(({ status }) => status === "created"));
  // A folder that blocked no item is the only failure left to show and retry.
  const failed = computed(() => {
    const rows = items.value.filter(({ status }) => status === "failed");
    if (rows.length || running.value) return rows;
    return (record.value?.items ?? []).filter(
      (item) => !countsAsItem(item) && item.status === "failed",
    );
  });
  const skipped = computed(() => items.value.filter(({ status }) => status === "skipped"));
  const toCreate = computed(() =>
    items.value.filter((item) => item.status !== "existing" && notSkipped(item)),
  );
  const interrupted = computed(
    () => !running.value && !!record.value && record.value.status !== "complete",
  );
  const installed = computed(() => record.value?.status === "complete");
  const alertsTotal = computed(
    () => items.value.filter(({ kind, status }) => kind === "alert" && status === "created").length,
  );
  const undoLeftUs = computed(() => {
    const at = record.value?.installedAt;
    return at ? Math.max(0, at + UNDO_WINDOW_US - nowUs.value) : 0;
  });
  const canManage = computed(() => canManageInstall(store.state, record.value));
  const canUndo = computed(() => canManage.value && undoLeftUs.value > 0);

  const readAlertsOn = async () => {
    const rows = await readQuery(alertsByTagsQuery(org, [`pack:${pack.id}`]), true);
    enabledAlertIds.value = new Set(rows.filter((row) => row.enabled).map((row) => row.alert_id));
    alertsOn.value = enabledAlertIds.value.size;
  };

  const load = async () => {
    loadFailed.value = false;
    try {
      record.value = newestRecord(await listInstalls(pack.id));
      if (record.value) await readAlertsOn();
    } catch (error) {
      // A retry cannot get past a refusal, so it reads as ask an admin, not as a failed load.
      if (isForbidden(error)) forbidden.value = true;
      else loadFailed.value = true;
    }
    loaded.value = true;
  };

  const loadPreview = async () => {
    previewRun += 1;
    const run = previewRun;
    previewState.value = "loading";
    try {
      const next = await previewPack(pack, choices.value);
      if (run !== previewRun) return;
      preview.value = next;
      previewState.value = "ready";
    } catch (error) {
      if (run !== previewRun) return;
      if (isForbidden(error)) forbidden.value = true;
      previewState.value = isForbidden(error) ? "forbidden" : "error";
    }
  };

  /** Records one answer; the next preview redoes the plan, so counts and rows stay one source. */
  const chooseStream = (want: string, choice: PackChoices["streams"][string]) => {
    choices.value = { ...choices.value, streams: { ...choices.value.streams, [want]: choice } };
    return loadPreview();
  };

  /** One name means one meaning, so a change reaches every stream that has the column. */
  const chooseField = (field: string, to: string) => {
    if (to === RESERVED_FIELD) return Promise.resolve();
    const fields = { ...choices.value.fields };
    for (const { stream, from } of preview.value?.bindings ?? []) {
      if (from === field && preview.value?.columns[stream]?.includes(to)) {
        fields[`${stream}/${from}`] = to;
      }
    }
    choices.value = { ...choices.value, fields };
    return loadPreview();
  };

  // The preview may still be loading or have failed, so the pack's own names come before the id.
  const packNames: Record<string, string> = Object.fromEntries([
    ...(pack.bundledAlerts ?? []).map(({ entry }) => [entry.id, entry.title]),
    ...pack.savedViews.map(({ id, name }) => [id, name]),
    ...pack.dashboards.map(({ id, title }) => [id, title]),
  ]);
  const nameOf = (itemId: string) => preview.value?.names[itemId] ?? packNames[itemId] ?? itemId;

  const planned = (kind: PackRecordItem["kind"]) =>
    (preview.value?.items ?? []).filter((item) => item.kind === kind && item.status !== "existing");
  // Null until the preview loads, since the raw pack counts items the data may not support.
  const alertCount = computed(() => (preview.value ? planned("alert").length : null));
  const dashboardCount = computed(() => (preview.value ? planned("dashboard").length : null));
  const viewCount = computed(() => (preview.value ? planned("savedView").length : null));

  const folderOf = (type: "alerts" | "dashboards") =>
    record.value?.items.find((item) => item.kind === "folder" && item.itemId === type)?.id;

  const alertsRoute = computed(() => ({
    name: "alertList",
    query: { org_identifier: org, folder: folderOf("alerts") },
  }));

  const dashboardsRoute = computed(() => ({
    name: "dashboards",
    query: { org_identifier: org, folder: folderOf("dashboards") },
  }));

  /** Where a created item opens; Logs has no saved-view link, so a view runs its search. */
  const itemRoute = (item: PackRecordItem): RouteLocationRaw => {
    if (item.kind === "alert") {
      return {
        name: "alertDetail",
        params: { alert_id: item.id ?? "" },
        query: { org_identifier: org, folder: item.folderId || "default" },
      };
    }
    if (item.kind === "dashboard") {
      return {
        name: "viewDashboard",
        query: { org_identifier: org, dashboard: item.id ?? "", folder: item.folderId ?? "" },
      };
    }
    const view = pack.savedViews.find(({ id }) => id === item.itemId);
    const stream = view
      ? adaptSavedView(view.search, record.value?.repairs ?? []).data?.stream
      : null;
    return {
      name: "logs",
      query: {
        org_identifier: org,
        ...(stream?.selectedStream?.length
          ? { stream_type: stream.streamType ?? "logs", stream: stream.selectedStream.join(",") }
          : {}),
      },
    };
  };

  const isOpenable = ({ kind, id }: PackRecordItem) => kind === "dashboard" && !!id;
  // With nothing left to create there is no record, only the dashboard the preview found.
  const dashboardItem = computed(
    () => record.value?.items.find(isOpenable) ?? preview.value?.items.find(isOpenable),
  );

  /** The pack's first dashboard, so the user sees the result at once. */
  const land = async () => {
    const item = dashboardItem.value;
    if (!item?.id) return;
    const query = { org_identifier: org, dashboard: item.id, folder: item.folderId ?? "" };
    await router.push({ name: "viewDashboard", query }).catch(() => {});
  };

  // Alerts made enabled are on without a re-read, so Home never calls them silent.
  const trackEnabled = (next: PackInstallRecord) => {
    const ids = next.items
      .filter(({ kind, status, id }) => kind === "alert" && status === "created" && id)
      .map(({ id }) => id!);
    enabledAlertIds.value = new Set([...enabledAlertIds.value, ...ids]);
    alertsOn.value = enabledAlertIds.value.size;
  };

  const install = async (folderName?: string, choice: PackInstallChoice = {}): Promise<boolean> => {
    if (running.value) return false;
    const { exclude: unticked = [], enableAlerts = false, destination } = choice;
    running.value = true;
    installFailed.value = false;
    forbidden.value = false;
    busyBy.value = null;
    try {
      const plan = preview.value ?? (await previewPack(pack, choices.value));
      const exclude = [...new Set([...leftOutIds(plan), ...unticked])];
      const done = await installPack(pack, {
        exclude,
        repairs: plan.repairs,
        bindings: plan.bindings,
        flavours: plan.flavours,
        copies: plan.copies,
        folderName,
        enableAlerts,
        destination,
        onProgress: (next) => {
          record.value = { ...next, items: [...next.items] };
          if (enableAlerts) trackEnabled(next);
        },
      });
      record.value = { ...done, items: [...done.items] };
      if (enableAlerts) trackEnabled(done);
      // Alerts the lookup found keep their own state, so only the server knows which are on.
      const tracked = enabledAlertIds.value;
      await readAlertsOn().catch(() => {});
      // The tag search trails a create, so keep the alerts this run just made on.
      enabledAlertIds.value = new Set([...enabledAlertIds.value, ...tracked]);
      alertsOn.value = enabledAlertIds.value.size;
      return done.status === "complete";
    } catch (error) {
      if (error instanceof StarterPackPermissionError) forbidden.value = true;
      else if (error instanceof StarterPackBusyError) busyBy.value = error.installedBy;
      else installFailed.value = true;
      return false;
    } finally {
      running.value = false;
      void refreshOrgResources(org);
    }
  };

  /** Finishes an interrupted install the way it was asked for, even after a reload. */
  const retry = () => {
    const { enableAlerts, destination } = record.value ?? {};
    return install(undefined, { enableAlerts, destination });
  };

  const applyRemoval = async (work: () => Promise<PackRemovalResult>) => {
    busy.value = true;
    removalFailed.value = false;
    try {
      const result = await work();
      removal.value = result;
      removalFailed.value = result.kept.some(({ reason }) => reason === "delete_failed");
      await load();
      if (!installed.value) useBrowserMatches(org).markRemoved(pack.id);
      // A plan read before the removal still counts the removed items as existing.
      if (previewState.value !== "idle") await loadPreview();
      return !removalFailed.value;
    } catch {
      removalFailed.value = true;
      return false;
    } finally {
      busy.value = false;
      void refreshOrgResources(org);
    }
  };

  const undo = () => {
    const installId = record.value?.installId;
    return applyRemoval(() =>
      installId ? undoPack(pack, installId) : Promise.resolve({ removed: [], kept: [] }),
    );
  };

  const remove = () => applyRemoval(() => removePack(pack));

  return {
    alertCount,
    alertsOn,
    alertsRoute,
    alertsTotal,
    busy,
    busyBy,
    canManage,
    canUndo,
    chooseField,
    chooseStream,
    dashboardCount,
    dashboardItem,
    dashboardsRoute,
    enabledAlertIds,
    failed,
    forbidden,
    install,
    installFailed,
    installed,
    interrupted,
    itemRoute,
    items,
    land,
    licensed,
    load,
    loadFailed,
    loadPreview,
    loaded,
    made,
    nameOf,
    org,
    pack,
    preview,
    previewState,
    record,
    remove,
    removal,
    removalFailed,
    retry,
    running,
    skipped,
    toCreate,
    undo,
    undoLeftUs,
    viewCount,
  };
}

export type StarterPackFlow = ReturnType<typeof useStarterPackFlow>;
