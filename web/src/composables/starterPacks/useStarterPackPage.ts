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

import { computed, ref, shallowRef } from "vue";

import { readQuery } from "@/composables/query/readQuery";
import { STARTER_PACKS_ENABLED } from "@/constants/starterPacks";
import { alertHistoryQuery, firingAlertsQuery } from "@/services/alerts.queries";
import { permittedFoldersQuery } from "@/services/common.queries";
import { isFiringNow } from "@/utils/alerts/firingAlerts";

import { dashboardStreams } from "./dashboardFit";
import { buildContentRows } from "./packContents";
import { packStreams, type PackStream } from "./packStreams";
import type { StarterPack } from "./types";
import { usePackHealth } from "./usePackHealth";
import { usePackUpdates } from "./usePackUpdates";
import { alertStreams, useRepairLater } from "./useRepairLater";
import { useStarterPackFlow } from "./useStarterPackFlow";
import { useStarterPackMatcher } from "./useStarterPackMatcher";
import { useStarterPacks } from "./useStarterPacks";
import { useTurnOnAlerts, type TurnOnRow } from "./useTurnOnAlerts";
import { queriesPerDay } from "./wouldFire";

const FIRED_WINDOW_US = 7 * 24 * 60 * 60 * 1_000_000;

export type PackPageState = "loading" | "error" | "installed" | "empty";

/** Everything the single pack page reads and does, so its tabs stay views. */
export function useStarterPackPage(org: string, pack: StarterPack) {
  const flow = useStarterPackFlow(org, pack);
  const matcher = useStarterPackMatcher(org, { pack });
  const turn = useTurnOnAlerts(org, flow);
  const health = usePackHealth(org);
  const updates = usePackUpdates(org, flow);
  const repair = useRepairLater(org);
  const { readSnapshot, appendToInstall } = useStarterPacks(org);

  const fired = shallowRef<Record<string, number>>({});
  const firing = shallowRef<Set<string>>(new Set());
  const muted = shallowRef<Set<string>>(new Set());
  const snapshots = shallowRef<Map<string, Record<string, any> | null>>(new Map());
  const unreadable = shallowRef<Set<string>>(new Set());
  const plannedDashboards = shallowRef<Map<string, Record<string, any>>>(new Map());
  const folderNames = ref<string[]>([]);
  const lastRunAt = ref<number | null>(null);
  const refreshing = ref(false);
  // Until the first full load ends, values computed from part of the data would show a wrong state.
  const settled = ref(false);
  const adding = ref<string | null>(null);

  const pageState = computed<PackPageState>(() => {
    if (!flow.loaded.value || (!settled.value && !flow.loadFailed.value)) return "loading";
    if (flow.loadFailed.value) return "error";
    return flow.record.value ? "installed" : "empty";
  });
  const installed = computed(() => pageState.value === "installed");
  const canManage = computed(
    () => flow.canManage.value && !flow.forbidden.value && !turn.forbidden.value,
  );
  const viewOnly = computed(() => installed.value && !canManage.value);

  const rows = computed(() => turn.rows.value);
  const onRows = computed(() => rows.value.filter(({ enabled }) => enabled));
  const pausedRows = computed(() => rows.value.filter(({ enabled }) => !enabled));
  // What the alerts cost once on, paused ones included, so the figure does not read 0 while they wait.
  const perDay = computed(() => queriesPerDay(rows.value.map(({ alert }) => alert)));
  // A repaired alert's query reads the new stream while its stream setting keeps the name it was created with.
  const readsOf = ({ alert }: TurnOnRow): string[] => {
    const reads = STARTER_PACKS_ENABLED ? [...alertStreams(alert)] : [];
    return reads.length ? reads : [alert.stream_name].filter(Boolean);
  };
  const silentIds = computed(
    () =>
      new Set(
        onRows.value
          .filter(({ id, alert }) => (fired.value[id] ?? 0) > 0 && !alert.destinations?.length)
          .map(({ id }) => id),
      ),
  );

  const contents = computed(() =>
    buildContentRows({
      pack,
      record: flow.record.value,
      preview: flow.preview.value,
      alerts: rows.value,
      firing: firing.value,
      muted: muted.value,
      snapshots: snapshots.value,
      unreadable: unreadable.value,
      planned: plannedDashboards.value,
      readsOf,
      nameOf: flow.nameOf,
    }),
  );

  const streamList = computed<PackStream[]>(() => {
    const record = flow.record.value;
    const plan = record ?? flow.preview.value;
    const alertIds = (plan?.items ?? [])
      .filter(({ kind, status }) => kind === "alert" && status !== "skipped")
      .map(({ copyOf, itemId }) => copyOf ?? itemId);
    const madeDashboards = [...snapshots.value.entries()]
      .filter(([itemId, doc]) => doc && pack.dashboards.some(({ id }) => id === itemId))
      .flatMap(([, doc]) => dashboardStreams(doc!));
    return packStreams(pack, {
      flavourIds: [...new Set(Object.values(plan?.flavours ?? {}))],
      alertIds,
      alertStreams: rows.value.flatMap((row) =>
        readsOf(row).map((name) => ({ name, type: String(row.alert.stream_type ?? "") })),
      ),
      dashboardStreams: record
        ? madeDashboards
        : [...plannedDashboards.value.values()].flatMap((doc) => dashboardStreams(doc)),
      repairs: plan?.repairs ?? [],
    });
  });
  const streamHealth = computed(() => health.streams.value);
  const healthOf = (name: string) => streamHealth.value.find((row) => row.name === name);
  const brokenStreams = computed(() =>
    streamHealth.value.filter(({ state }) => state === "stopped" || state === "never"),
  );

  const failedItems = computed(() => flow.failed.value);
  const repairIssue = computed(() => repair.issue.value);
  const needsAttention = computed(
    () =>
      failedItems.value.length > 0 ||
      !!repairIssue.value ||
      silentIds.value.size > 0 ||
      brokenStreams.value.length > 0,
  );
  const status = computed(() => {
    if (!installed.value) return "notSetUp";
    if (!canManage.value) return "viewOnly";
    if (contents.value.some(({ state }) => state === "firing")) return "firing";
    return needsAttention.value ? "needsAttention" : "ready";
  });

  const readFired = async () => {
    const end = Date.now() * 1000;
    const counts = await Promise.all(
      onRows.value.map(async ({ id }) => {
        const query = {
          alert_id: id,
          status: "firing",
          start_time: end - FIRED_WINDOW_US,
          end_time: end,
          from: 0,
          size: 1,
        };
        const reply = await readQuery(alertHistoryQuery(org, query)).catch(() => null);
        return [id, Number(reply?.total ?? 0)] as const;
      }),
    );
    fired.value = Object.fromEntries(counts);
  };

  const readFiring = async (force: boolean) => {
    const page = await readQuery(firingAlertsQuery(org), force).catch(() => null);
    const live = (page?.list ?? []).filter(isFiringNow);
    firing.value = new Set(live.map(({ alert_id }) => alert_id));
    muted.value = new Set(
      live.filter(({ active_downtime }) => active_downtime != null).map(({ alert_id }) => alert_id),
    );
  };

  // One read per dashboard and view: it feeds the Changes column, and a dashboard's streams too.
  // readSnapshot gives null only for a deleted item; any other failure is kept apart as unreadable.
  const readSnapshots = async () => {
    const items = (flow.record.value?.items ?? []).filter(
      ({ kind, status, id }) =>
        (kind === "dashboard" || kind === "savedView") &&
        (status === "created" || status === "existing") &&
        id,
    );
    const failed = new Set<string>();
    const read = await Promise.all(
      items.map(async (item) => {
        const doc = await readSnapshot(pack, item).catch(() => {
          failed.add(item.itemId);
          return null;
        });
        return [item.itemId, (doc as Record<string, any> | null) ?? null] as const;
      }),
    );
    snapshots.value = new Map(read);
    unreadable.value = failed;
  };

  const readPlannedDashboards = async () => {
    const docs = await Promise.all(
      pack.dashboards.map((dashboard) => dashboard.load().catch(() => null)),
    );
    plannedDashboards.value = new Map(
      pack.dashboards.flatMap(({ id }, index) => (docs[index] ? [[id, docs[index]!]] : [])),
    );
  };

  const loadNotSetUp = async () => {
    const reads: Promise<unknown>[] = [flow.loadPreview(), readPlannedDashboards()];
    if (flow.isAdmin.value) {
      reads.push(
        readQuery(permittedFoldersQuery(org, "alerts"))
          .catch(() => [])
          .then((folders) => {
            folderNames.value = folders.map(({ name }) => name);
          }),
      );
    }
    await Promise.all(reads);
    await health.checkStreams(streamList.value);
  };

  const loadInstalled = async (force: boolean) => {
    await turn.load({ count: false });
    if (STARTER_PACKS_ENABLED && canManage.value) {
      void updates.check();
      void repair.check({ packId: pack.id });
    }
    await Promise.all([
      flow.loadPreview(),
      readFired(),
      readFiring(force),
      readSnapshots(),
      matcher.check(),
    ]);
    await health.checkStreams(streamList.value, force);
  };

  const refresh = async (force = false) => {
    refreshing.value = true;
    try {
      await flow.load();
      if (flow.loadFailed.value) return;
      if (flow.record.value) await loadInstalled(force);
      else await loadNotSetUp();
      lastRunAt.value = Date.now();
    } finally {
      refreshing.value = false;
      settled.value = true;
    }
  };

  /** Resumes the install with its stored alert choice, which makes again only what failed. */
  const retry = async () => {
    await flow.retry();
    await refresh();
  };

  const addNow = async (itemId: string) => {
    const record = flow.record.value;
    if (!record) return false;
    adding.value = itemId;
    try {
      await appendToInstall(pack, record.installId, [itemId], {
        repairs: record.repairs,
        bindings: record.bindings,
        flavours: record.flavours,
      });
      return true;
    } catch {
      return false;
    } finally {
      adding.value = null;
      await refresh();
    }
  };

  return {
    adding,
    addNow,
    brokenStreams,
    canManage,
    contents,
    failedItems,
    fired,
    flow,
    folderNames,
    health,
    healthOf,
    installed,
    lastRunAt,
    matcher,
    onRows,
    pageState,
    pausedRows,
    perDay,
    readsOf,
    refresh,
    refreshing,
    repair,
    repairIssue,
    retry,
    silentIds,
    status,
    streamHealth,
    streamList,
    turn,
    updates,
    viewOnly,
  };
}

export type StarterPackPage = ReturnType<typeof useStarterPackPage>;
