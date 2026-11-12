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
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import { readQuery } from "@/composables/query/readQuery";
import { alertsByTagsQuery } from "@/services/alerts.queries";
import { featureState } from "@/utils/featureGate";

import {
  StarterPackPermissionError,
  leftOutIds,
  type PackChoices,
  type PackInstallRecord,
  type PackPreview,
  type PackRecordItem,
  type PackRemovalResult,
  type StarterPack,
} from "./types";
import { RESERVED_FIELD } from "./packBinding";
import { useStarterPacks } from "./useStarterPacks";

export const UNDO_WINDOW_US = 24 * 60 * 60 * 1_000_000;

const CLOCK_TICK_MS = 60_000;

export type PackPreviewState = "idle" | "loading" | "ready" | "error";

/** What the user changed in the plan before setup. */
export interface PackInstallChoice {
  /** Item ids the user unticked, on top of the ones the preview leaves out. */
  exclude?: string[];
  enableAlerts?: boolean;
}

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
  const {
    installPack,
    previewPack,
    undoPack,
    removePack,
    listInstalls,
    trackAlertEdit,
    writeRecord,
  } = useStarterPacks(org);

  const record = shallowRef<PackInstallRecord | null>(null);
  const loaded = ref(false);
  const loadFailed = ref(false);
  const running = ref(false);
  const busy = ref(false);
  const installFailed = ref(false);
  const forbidden = ref(false);
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

  const isAdmin = computed(() => isOrgAdmin(store.state));
  const licensed = computed(
    () =>
      !!pack.nativeView &&
      featureState(store.state.zoConfig?.features, pack.nativeView.feature) === "enabled",
  );

  const items = computed(() => (record.value?.items ?? []).filter(countsAsItem));
  const made = computed(() => items.value.filter(({ status }) => status === "created"));
  const failed = computed(() => items.value.filter(({ status }) => status === "failed"));
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
  const remindAlerts = computed(
    () => alertsTotal.value > 0 && alertsOn.value === 0 && !record.value?.keptOff,
  );
  const alertsOff = computed(() => Math.max(0, alertsTotal.value - alertsOn.value));
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

  /** The address a colleague opens, so it must survive leaving this browser. */
  const packLink = () => {
    const { href } = router.resolve(packRoute.value);
    return new URL(href, window.location.origin).href;
  };

  const keepOff = async () => {
    if (!record.value) return;
    const next = { ...record.value, keptOff: true };
    await writeRecord(next);
    record.value = next;
  };

  const load = async () => {
    loadFailed.value = false;
    try {
      record.value = newestRecord(await listInstalls(pack.id));
      if (record.value) await readAlertsOn();
    } catch {
      loadFailed.value = true;
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
    } catch {
      if (run === previewRun) previewState.value = "error";
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

  const nameOf = (itemId: string) => preview.value?.names[itemId] ?? itemId;

  const planned = (kind: PackRecordItem["kind"]) =>
    (preview.value?.items ?? []).filter((item) => item.kind === kind && item.status !== "existing");
  const alertCount = computed(() => (preview.value ? planned("alert").length : pack.alerts.length));
  const dashboardCount = computed(() =>
    preview.value ? planned("dashboard").length : pack.dashboards.length,
  );
  const viewCount = computed(() =>
    preview.value ? planned("savedView").length : pack.savedViews.length,
  );

  const alertsRoute = computed(() => ({
    name: "alertList",
    query: {
      org_identifier: org,
      folder: record.value?.items.find((item) => item.kind === "folder" && item.itemId === "alerts")
        ?.id,
    },
  }));

  const packRoute = computed(() => ({
    name: "starterPack",
    params: { pack: pack.id },
    query: { org_identifier: org },
  }));

  const isOpenable = ({ kind, id }: PackRecordItem) => kind === "dashboard" && !!id;
  // With nothing left to create there is no record, only the dashboard the preview found.
  const dashboardItem = computed(
    () => record.value?.items.find(isOpenable) ?? preview.value?.items.find(isOpenable),
  );

  /** The pack's first dashboard, so the user sees the installed data at once. */
  const land = async () => {
    const query: Record<string, string> = { org_identifier: org };
    const item = dashboardItem.value;
    if (!item?.id) {
      await router.push({ name: "dashboards", query }).catch(() => {});
      return;
    }
    query.dashboard = item.id;
    query.folder = item.folderId ?? "";
    query.pack = pack.id;
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

  const install = async (
    folderName?: string,
    { exclude: unticked = [], enableAlerts = false }: PackInstallChoice = {},
  ): Promise<boolean> => {
    if (running.value) return false;
    running.value = true;
    installFailed.value = false;
    forbidden.value = false;
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
        onProgress: (next) => {
          record.value = { ...next, items: [...next.items] };
          if (enableAlerts) trackEnabled(next);
        },
      });
      record.value = { ...done, items: [...done.items] };
      if (enableAlerts) trackEnabled(done);
      return done.status === "complete";
    } catch (error) {
      if (error instanceof StarterPackPermissionError) forbidden.value = true;
      else installFailed.value = true;
      return false;
    } finally {
      running.value = false;
    }
  };

  const applyRemoval = async (work: () => Promise<PackRemovalResult>) => {
    busy.value = true;
    removalFailed.value = false;
    try {
      const result = await work();
      removal.value = result;
      removalFailed.value = result.kept.some(({ reason }) => reason === "delete_failed");
      await load();
      return !removalFailed.value;
    } catch {
      removalFailed.value = true;
      return false;
    } finally {
      busy.value = false;
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
    alertsOff,
    alertsOn,
    alertsRoute,
    alertsTotal,
    busy,
    canManage,
    canUndo,
    chooseField,
    chooseStream,
    dashboardCount,
    enabledAlertIds,
    failed,
    forbidden,
    install,
    installFailed,
    installed,
    interrupted,
    isAdmin,
    keepOff,
    items,
    land,
    licensed,
    load,
    loadFailed,
    loadPreview,
    loaded,
    made,
    nameOf,
    pack,
    packLink,
    packRoute,
    preview,
    previewState,
    record,
    remindAlerts,
    remove,
    removal,
    removalFailed,
    running,
    skipped,
    toCreate,
    trackAlertEdit,
    undo,
    undoLeftUs,
    viewCount,
  };
}

export type StarterPackFlow = ReturnType<typeof useStarterPackFlow>;
