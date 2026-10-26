<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { gt, raw, useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import DateTime from "@/components/DateTime.vue";
import DataSourceSetupCard from "@/components/ingestion/setupCard/DataSourceSetupCard.vue";
import K8sListView from "./K8sListView.vue";
import MapView from "./MapView.vue";
import ClusterOverview from "./ClusterOverview.vue";
import WorkloadsOverview from "./WorkloadsOverview.vue";
import K8sDetailsDrawer from "./K8sDetailsDrawer.vue";
import K8sCommandPalette from "./K8sCommandPalette.vue";
import K8sDock from "./K8sDock.vue";
import { metricsRoute, pickTracesStream, tracesRoute } from "./k8sNavigation";
import useStreams from "@/composables/useStreams";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { K8sAction } from "./k8sActions";
import {
  closeTab,
  emptyDock,
  openTab,
  selectTab,
  toggleMaximized,
  toggleMinimized,
} from "./dockState";
import K8sClusterHotbar from "./K8sClusterHotbar.vue";
import K8sResourceTree from "./K8sResourceTree.vue";
import {
  buildTree,
  clusterCodes,
  clusterSeen,
  clusterStatsOf,
  clusterTone,
  nodeSummary,
} from "./k8sTree";
import OButton from "@/lib/core/Button/OButton.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { buildPaletteItems, mergePaletteItems, type PaletteItem } from "./k8sPalette";
import { usePaletteIndex } from "./usePaletteIndex";
import { useKubernetesInventory, type K8sTime } from "./useKubernetesInventory";
import { KIND_INFO, MAP_ANCHOR, groupsPodsByNode, type View } from "./kubernetesQueries";
import {
  INVENTORY_KEY,
  findRow,
  rowKey,
  type AnyRow,
  type NodeRow,
  type PodRow,
} from "./kubernetesModel";
import type { MapObjects } from "./mapFilter";
import {
  DEFAULT_GROUP,
  ENTITY_FILLS,
  isCanonical,
  parseUrlState,
  stripPageParams,
  toQuery,
  withDetails,
  withView,
  type DetailsRef,
  type K8sUrlState,
} from "./kubernetesUrlState";

type ListView = Exclude<View, "cluster" | "map" | "workloads">;

const DEFAULT_RELATIVE_PERIOD = "1h";
const DEFAULT_WINDOW_US = 60 * 60 * 1000 * 1000;
const BODY_ANCHOR = "[data-k8s2-views]";

const store = useStore();
// useStreams injects the store, which only works during setup, never inside a handler.
const streamsApi = useStreams(gt);
const route = useRoute();
const router = useRouter();
const { t } = useI18nTyped();

const state = computed(() => parseUrlState(route.query));
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");
const nowUs = () => Date.now() * 1000;
const range = ref<K8sTime>({ start: nowUs() - DEFAULT_WINDOW_US, end: nowUs(), relative: true });
const dateTimePickerRef = ref<{
  refresh?: () => void;
  setRelativeDate?: (period: string, value: number) => void;
} | null>(null);

const k8s = useKubernetesInventory(
  () => state.value,
  () => range.value,
  () => orgId.value,
);
const { detection, pageError } = k8s;

const replace = (next: K8sUrlState) => router.replace({ query: toQuery(next, route.query) as any });
const push = (next: K8sUrlState) => router.push({ query: toQuery(next, route.query) as any });

const ready = computed(() => detection.value === "detected" && !pageError.value);

const clusterOptions = computed(() => k8s.clusters.value.map((c) => ({ label: raw(c), value: c })));

const stats = computed(() => clusterStatsOf(k8s.clusterResults.value, k8s.effectiveCluster.value));

const hotbarClusters = computed(() => {
  const codes = clusterCodes(k8s.clusters.value);
  return k8s.clusters.value.map((name) => {
    const own = clusterStatsOf(k8s.clusterResults.value, name);
    const total = own?.nodes ?? 0;
    return {
      name,
      code: codes[name],
      tone: clusterTone(own),
      nodes: total ? { total, ready: Math.max(total - (own?.nodesBad ?? 0), 0) } : null,
    };
  });
});

const treeGroups = computed(() =>
  buildTree({
    inventory: k8s.inventory.value,
    cluster: k8s.effectiveCluster.value,
    events: {
      total:
        k8s.eventCounts.value?.total ??
        (k8s.hasEvents.value && state.value.view === "events" ? k8s.events.value.length : null),
      warnings: k8s.eventCounts.value?.warnings ?? 0,
    },
    stats: stats.value,
  }),
);

const treeNodes = computed(() =>
  nodeSummary(k8s.inventory.value, k8s.effectiveCluster.value, stats.value),
);

const crumbs = computed(() => {
  const group = treeGroups.value.find((g) => g.items.some((i) => i.view === state.value.view));
  const item = group?.items.find((i) => i.view === state.value.view);
  return group && item
    ? {
        group: t(group.label),
        view:
          group.id === "workloads" && item.view === "workloads"
            ? t("infra.k8s2.treeOverview")
            : t(item.label),
      }
    : null;
});

// Below md the hot-bar and tree are hidden, so views stay reachable through a select.
const viewOptions = computed(() =>
  treeGroups.value.flatMap((group) => [
    { label: t(group.label), header: true },
    ...group.items.map((item) => ({
      label:
        item.count == null
          ? t(item.label)
          : t("infra.k8s2.viewOptionCount", { label: t(item.label), count: item.count }),
      value: item.view,
    })),
  ]),
);

const onAddCluster = () =>
  router.push({ name: "ingestFromKubernetes", query: { org_identifier: orgId.value } });

const onCluster = (value: unknown) =>
  replace({ ...state.value, cluster: value ? String(value) : null, details: null });

// Fills, groups and label keys differ per entity, so an entity change starts from its defaults.
const onUpdate = (patch: Partial<K8sUrlState>) => {
  const next = { ...state.value, ...patch };
  if (patch.entity && patch.entity !== state.value.entity) {
    if (!ENTITY_FILLS[next.entity].includes(next.fill)) next.fill = ENTITY_FILLS[next.entity][0];
    next.group = DEFAULT_GROUP[next.entity];
    next.filter = [];
  }
  replace(next);
};

const sameDetails = (a: DetailsRef | null, b: DetailsRef) =>
  !!a &&
  a.kind === b.kind &&
  a.cluster === b.cluster &&
  a.namespace === b.namespace &&
  a.name === b.name;

// Clicking the row whose drawer is open closes it, as in Lens.
const onOpen = (details: DetailsRef) => {
  if (sameDetails(state.value.details, details)) closeDetails();
  else push(withDetails(state.value, details));
};

const onDrawerLink = (details: DetailsRef) => push(withDetails(state.value, details));

const closeDetails = () => replace({ ...state.value, details: null });

const onNavigate = (next: K8sUrlState) => push(next);

const onView = (view: View) => push(withView(state.value, view));

const onPatch = (patch: Partial<K8sUrlState>) =>
  push({ ...withView(state.value, patch.view ?? state.value.view), ...patch });

const scopedRows = (rows: AnyRow[]) => {
  const cluster = k8s.effectiveCluster.value;
  return cluster == null ? rows : rows.filter((row) => row.cluster === cluster);
};

// Stable arrays, so a render that changes neither does not re-run the map over every pod.
const mapPods = computed(() => scopedRows(k8s.inventory.value.pods) as PodRow[]);
const mapNodes = computed(() => scopedRows(k8s.inventory.value.nodes) as NodeRow[]);

const listRows = computed(() => {
  const view = state.value.view as ListView;
  if (view === "events") return k8s.events.value;
  const kind = (Object.keys(KIND_INFO) as (keyof typeof KIND_INFO)[]).find(
    (k) => KIND_INFO[k].view === view,
  );
  return kind ? scopedRows(k8s.inventory.value[INVENTORY_KEY[kind]] as AnyRow[]) : [];
});

const isList = computed(() => !["cluster", "map", "workloads"].includes(state.value.view));

const drawerRow = computed(() => {
  const d = state.value.details;
  return d
    ? findRow(k8s.inventory.value, d.kind, rowKey(d.kind, d.cluster, d.namespace, d.name))
    : null;
});

const unscopedChip = computed(() =>
  state.value.view === "events" && k8s.hasEvents.value && !k8s.eventsScoped.value
    ? t("infra.k8s2.eventsUnscoped")
    : undefined,
);

const mapAnchor = computed(() =>
  k8s.has(MAP_ANCHOR[state.value.entity]) ? null : MAP_ANCHOR[state.value.entity],
);

const mapObjects = computed<MapObjects>(() => {
  const name = `O:${state.value.entity === "nodes" ? "node" : "pod"}`;
  if (!k8s.hasEvents.value) return { state: "skipped", reason: "noStream" };
  if (!k8s.eventsScoped.value) return { state: "skipped", reason: "unscoped" };
  if (mapAnchor.value) return { state: "skipped", reason: "anchor" };
  if (!k8s.loading.value && !k8s.effectiveCluster.value) {
    return { state: "skipped", reason: "noCluster" };
  }
  if (k8s.objectsPending.value) return { state: "loading" };
  if (k8s.failed.value.has(name)) return { state: "failed" };
  return k8s.sql.value.has(name) ? { state: "ok" } : { state: "loading" };
});

// What a load depends on; search, sort, filter and most groupings only re-filter loaded rows.
const loadKey = computed(() => {
  const s = state.value;
  const byNode = s.view === "map" && groupsPodsByNode(s.entity, s.group);
  return JSON.stringify([s.view, s.cluster, s.namespaces, s.entity, byNode, s.details]);
});

const load = () => k8s.load();

const onRefresh = async () => {
  await k8s.loadStreams({ force: true });
  if (detection.value !== "detected") return;
  dateTimePickerRef.value?.refresh?.();
  await k8s.load({ force: true });
};

const onDateChange = (date: {
  startTime: number;
  endTime: number;
  valueType?: string;
  userChangedValue?: boolean;
}) => {
  range.value = {
    start: date.startTime,
    end: date.endTime,
    relative: date.valueType !== "absolute",
  };
  if (date.userChangedValue === false) return;
  const oneDay =
    date.valueType === "relative" && Math.abs(date.endTime - date.startTime - DAY_US) < 60_000_000;
  lastKnown.value = lastKnown.value && oneDay;
  load();
};

watch(loadKey, () => load());

// An events-only org has nothing for the metric views, so it lands on Events once, on arrival.
watch(detection, (next, prev) => {
  if (next !== "detected" || prev === "detected") return;
  const eventsOnly = !k8s.metricsDetected.value && k8s.hasEvents.value;
  if (eventsOnly && route.query.view == null) replace(withView(state.value, "events"));
  else load();
});

watch(
  () => store.state.selectedOrganization?.identifier,
  async (next, prev) => {
    if (!next || next === prev) return;
    k8s.reset();
    await router.replace({ query: stripPageParams(route.query) as any });
    await k8s.loadStreams({ force: true });
  },
);

watch(
  () => route.query,
  (query) => {
    if (!isCanonical(query)) replace(parseUrlState(query));
  },
  { immediate: true },
);

const paletteOpen = ref(false);
const paletteGroup = ref<"clusters" | null>(null);

const openPalette = () => {
  paletteGroup.value = null;
  paletteOpen.value = true;
};

const openClusterSwitcher = () => {
  paletteGroup.value = "clusters";
  paletteOpen.value = true;
};

const paletteIndex = usePaletteIndex({
  open: paletteOpen,
  cluster: computed(() => k8s.effectiveCluster.value),
  orgId,
  refreshNonce: k8s.refreshNonce,
  has: k8s.has,
});

// Built only while open: every pod becomes an item, which a large cluster should not pay for idly.
const paletteItems = computed(() =>
  paletteOpen.value
    ? mergePaletteItems(
        buildPaletteItems({
          inventory: k8s.inventory.value,
          clusters: k8s.clusters.value,
          activeCluster: k8s.effectiveCluster.value,
          t,
        }),
        paletteIndex.items.value,
      )
    : [],
);

const onPaletteSelect = ({ target }: PaletteItem) => {
  if (target.type === "view") onView(target.view);
  else if (target.type === "cluster") onCluster(target.cluster);
  else onDrawerLink(target.details);
};

useShortcuts([
  {
    id: "k8sPalette",
    handler: () => ready.value && (paletteOpen.value ? (paletteOpen.value = false) : openPalette()),
  },
]);

const dock = ref(emptyDock());

const DAY_US = 24 * 3_600_000_000;
const lastKnown = ref(false);

// Silent on every view when no cross-cluster query saw the cluster; on Overview and Nodes also when it has no rows.
const offline = computed(() => {
  const cluster = k8s.effectiveCluster.value;
  if (!ready.value || !k8s.loaded.value || k8s.loading.value || k8s.failed.value.size) return false;
  if (cluster == null) return false;
  if (!clusterSeen(k8s.clusterResults.value, cluster)) return true;
  return (
    ["cluster", "nodes"].includes(state.value.view) &&
    !mapNodes.value.length &&
    !mapPods.value.length
  );
});

const showLastKnown = () => {
  lastKnown.value = true;
  dateTimePickerRef.value?.setRelativeDate?.("d", 1);
};

watch(
  () => k8s.effectiveCluster.value,
  () => {
    lastKnown.value = false;
  },
);

const openTraces = async (ref: DetailsRef) => {
  const list: any = await streamsApi.getStreams("traces", false, false).catch(() => null);
  const stream = pickTracesStream(
    ((list?.list ?? []) as Array<{ name: string }>).map((s) => s.name),
  );
  if (!stream) {
    toast({ variant: "warning", message: t("infra.k8s2.tracesNoStream") });
    return;
  }
  const names = ((list?.list ?? []) as Array<{ name: string }>).length;
  if (names > 1) {
    toast({
      variant: "info",
      message: t("infra.k8s2.tracesStreamPicked", { stream: raw(stream) }),
    });
  }
  router.push(
    tracesRoute(ref, {
      orgId: orgId.value,
      start: range.value.start,
      end: range.value.end,
      stream,
    }),
  );
};

const onAction = (type: K8sAction, ref: DetailsRef) => {
  if (type === "details") onDrawerLink(ref);
  else if (type === "logs") dock.value = openTab(dock.value, type, ref);
  else if (type === "yaml") dock.value = openTab(dock.value, type, ref, dockRowOf(ref));
  else if (type === "metrics") {
    router.push(
      metricsRoute(ref, { orgId: orgId.value, start: range.value.start, end: range.value.end }),
    );
  } else if (type === "traces") void openTraces(ref);
};

const dockRowOf = (ref: DetailsRef) =>
  findRow(k8s.inventory.value, ref.kind, rowKey(ref.kind, ref.cluster, ref.namespace, ref.name));

const retryStreams = () => k8s.loadStreams({ force: true });

const retryPage = () => k8s.load({ force: true });

k8s.loadStreams();
</script>

<template>
  <OPageLayout :title="t('menu.kubernetes')" :subtitle="t('infra.k8s2.subtitle')" icon="hub" bleed>
    <template v-if="ready && crumbs" #subtitle>
      <OText class="flex min-w-0 items-center gap-1.5 text-sm" data-test="k8s2-breadcrumb">
        <span class="max-md:hidden">{{ raw(k8s.effectiveCluster.value ?? "") }}</span>
        <span class="max-md:hidden">/</span>
        <span>{{ crumbs.group }}</span>
        <span>/</span>
        <span class="text-text-heading font-semibold">{{ crumbs.view }}</span>
      </OText>
    </template>
    <template #actions>
      <div class="flex items-center gap-2">
        <OButton
          v-if="ready"
          class="max-md:hidden"
          variant="outline"
          size="sm"
          icon-left="search"
          data-test="k8s2-palette-open"
          @click="openPalette"
        >
          {{ t("infra.k8s2.paletteButton") }}
        </OButton>
        <OButton
          v-if="ready"
          class="md:hidden"
          variant="outline"
          size="icon-sm"
          :aria-label="t('infra.k8s2.paletteButton')"
          data-test="k8s2-palette-open-compact"
          @click="openPalette"
        >
          <OIcon name="search" size="sm" />
        </OButton>
        <OSelect
          v-if="ready"
          class="w-40 md:hidden"
          size="sm"
          :model-value="state.view"
          :options="viewOptions"
          :aria-label="t('infra.k8s2.viewSelect')"
          data-test="k8s2-view-select"
          @update:model-value="(view: unknown) => onView(view as View)"
        />
        <OSelect
          v-if="detection === 'detected' && clusterOptions.length"
          class="w-48 max-md:w-32 md:hidden"
          size="sm"
          searchable
          :model-value="k8s.effectiveCluster.value"
          :options="clusterOptions"
          data-test="k8s2-cluster-select"
          @update:model-value="onCluster"
        />
        <DateTime
          ref="dateTimePickerRef"
          auto-apply
          menu-align="end"
          default-type="relative"
          :default-relative-time="DEFAULT_RELATIVE_PERIOD"
          data-test-name="k8s2-date-time"
          @on:date-change="onDateChange"
        />
      </div>
    </template>

    <div v-if="ready" class="flex h-full min-h-0" data-test="k8s2-shell">
      <K8sClusterHotbar
        :clusters="hotbarClusters"
        :active="k8s.effectiveCluster.value"
        @select="onCluster"
        @all="openClusterSwitcher"
      />
      <K8sResourceTree
        class="max-md:hidden"
        :groups="treeGroups"
        :active="state.view"
        :nodes="treeNodes"
        @select="onView"
      />
      <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col" data-k8s2-body data-test="k8s2-body">
        <OBanner
          v-if="lastKnown && !offline"
          variant="info"
          dense
          :content="t('infra.k8s2.offlineLastKnown')"
          data-test="k8s2-banner-last-known"
        />
        <OBanner
          v-for="banner in offline ? [] : k8s.banners.value"
          :key="banner.id"
          :variant="banner.variant"
          dense
          :content="t(banner.key, banner.params ?? {})"
          :data-test="`k8s2-banner-${banner.id}`"
        />
        <div class="flex min-h-0 min-w-0 flex-1 flex-col" data-k8s2-views>
          <OEmptyState
            v-if="offline"
            preset="no-data"
            :title="
              t('infra.k8s2.offlineTitle', { cluster: raw(k8s.effectiveCluster.value ?? '') })
            "
            :description="
              t(lastKnown ? 'infra.k8s2.offlineLastKnownEmpty' : 'infra.k8s2.offlineDescription')
            "
            :action-label="lastKnown ? undefined : t('infra.k8s2.offlineShowLast')"
            :secondary-action-label="t('infra.k8s2.offlineGuide')"
            data-test="k8s2-offline"
            @action="showLastKnown"
            @secondary-action="onAddCluster"
          />
          <ClusterOverview
            v-else-if="state.view === 'cluster'"
            :inventory="k8s.inventory.value"
            :results="k8s.results.value"
            :warnings="k8s.warnings.value.rows"
            :cluster="k8s.effectiveCluster.value"
            :range="range"
            :refresh-nonce="k8s.refreshNonce.value"
            :has-stream="k8s.has"
            :loading="k8s.loading.value"
            :forbidden="k8s.forbidden.value"
            :last-updated-at="k8s.lastUpdatedAt.value"
            @open="onOpen"
            @navigate="onPatch"
            @action="onAction"
            @refresh="onRefresh"
          />
          <WorkloadsOverview
            v-else-if="state.view === 'workloads'"
            :inventory="k8s.inventory.value"
            :cluster="k8s.effectiveCluster.value"
            :namespaces="state.namespaces"
            :namespace-options="k8s.namespaceOptions.value"
            :events="k8s.events.value"
            :event-links-enabled="k8s.eventLinksEnabled.value"
            :end-us="range.end"
            :loading="k8s.loading.value"
            :last-updated-at="k8s.lastUpdatedAt.value"
            @update="onUpdate"
            @view="onView"
            @action="(a) => onAction(a.type, a.ref)"
            @open="onOpen"
            @refresh="onRefresh"
          />
          <MapView
            v-else-if="state.view === 'map'"
            :state="state"
            :pods="mapPods"
            :nodes="mapNodes"
            :namespace-options="k8s.namespaceOptions.value"
            :anchor-missing="mapAnchor"
            :objects="mapObjects"
            :failed-queries="[...k8s.failed.value.keys()]"
            :forbidden="k8s.forbidden.value"
            :loading="k8s.loading.value"
            :last-updated-at="k8s.lastUpdatedAt.value"
            @update="onUpdate"
            @open="onOpen"
            @navigate="onNavigate"
            @refresh="onRefresh"
          />
          <K8sListView
            v-else-if="isList"
            :view="state.view as ListView"
            :rows="listRows"
            :pods="k8s.inventory.value.pods"
            :state="state"
            :end-us="range.end"
            :cluster="k8s.effectiveCluster.value"
            :event-links="k8s.eventLinksEnabled.value"
            :namespace-options="k8s.namespaceOptions.value"
            :loading="k8s.loading.value && k8s.viewStale.value"
            :forbidden="k8s.forbidden.value"
            :anchor-missing="k8s.anchorMissing(state.view)"
            :capped="state.view === 'events' && k8s.eventsCapped.value"
            :chip="unscopedChip"
            :last-updated-at="k8s.lastUpdatedAt.value"
            @open="onOpen"
            @update="onUpdate"
            @refresh="onRefresh"
            @action="onAction"
          />
        </div>
        <K8sDock
          :dock="dock"
          :reserve-drawer="!!state.details"
          :org-id="orgId"
          :range="range"
          :row-of="dockRowOf"
          @select="(id) => (dock = selectTab(dock, id))"
          @close="(id) => (dock = closeTab(dock, id))"
          @minimize="dock = toggleMinimized(dock)"
          @maximize="dock = toggleMaximized(dock)"
          @dismiss="dock = emptyDock()"
        />
      </div>
    </div>

    <div
      v-else-if="detection === 'unknown'"
      class="flex min-h-60 items-center justify-center"
      data-test="k8s2-spinner"
    >
      <OSpinner size="lg" />
    </div>

    <OEmptyState
      v-else-if="detection === 'error'"
      preset="load-error"
      :title="t('infra.k8s2.streamsError')"
      data-test="k8s2-streams-error"
      @action="retryStreams"
    />

    <div v-else-if="detection === 'undetected'" class="min-h-0 flex-1 overflow-y-auto">
      <div
        class="max-lg:px-page-edge mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-3 py-6"
        data-test="k8s2-empty-state"
      >
        <OText tag="h2" class="text-xl font-semibold">{{ t("infra.k8s2.emptyHeadline") }}</OText>
        <DataSourceSetupCard slug="kubernetes" @detected="retryStreams" />
      </div>
    </div>

    <OEmptyState
      v-else-if="pageError"
      preset="load-error"
      :title="t('infra.k8s2.pageError')"
      :description="raw(pageError)"
      data-test="k8s2-page-error"
      @action="retryPage"
    />

    <K8sCommandPalette
      v-if="ready"
      v-model:open="paletteOpen"
      :group="paletteGroup"
      :items="paletteItems"
      :loading="paletteIndex.loading.value"
      :index-failed="paletteIndex.failed.value"
      :truncated="paletteIndex.truncated.value"
      @select="onPaletteSelect"
    />

    <K8sDetailsDrawer
      v-if="ready && state.details"
      :details="state.details"
      :row="drawerRow"
      :inventory="k8s.inventory.value"
      :pending="k8s.detailLoading.value || !k8s.loaded.value"
      :observed="k8s.detailObserved.value"
      :has-events="k8s.hasEvents.value"
      :events-failed="k8s.detailEventsFailed.value"
      :events-scoped="k8s.eventsScoped.value"
      :events="k8s.detailEvents.value"
      :range="range"
      :refresh-nonce="k8s.refreshNonce.value"
      :org-id="orgId"
      :has-stream="k8s.has"
      :anchor="BODY_ANCHOR"
      @close="closeDetails"
      @open="onDrawerLink"
      @navigate="onPatch"
      @action="onAction"
    />
  </OPageLayout>
</template>
