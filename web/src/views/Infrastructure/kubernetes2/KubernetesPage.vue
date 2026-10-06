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
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import DateTime from "@/components/DateTime.vue";
import SectionRail from "@/components/common/SectionRail.vue";
import type { SectionHubGroup } from "@/components/common/SectionHub.vue";
import DataSourceSetupCard from "@/components/ingestion/setupCard/DataSourceSetupCard.vue";
import K8sListView from "./K8sListView.vue";
import MapView from "./MapView.vue";
import ClusterOverview from "./ClusterOverview.vue";
import WorkloadsOverview from "./WorkloadsOverview.vue";
import K8sDetailsDrawer from "./K8sDetailsDrawer.vue";
import { useKubernetesInventory, type K8sTime } from "./useKubernetesInventory";
import { KIND_INFO, MAP_ANCHOR, type View } from "./kubernetesQueries";
import { INVENTORY_KEY, findRow, rowKey, type AnyRow } from "./kubernetesModel";
import {
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
const BODY_ANCHOR = "[data-k8s2-body]";

const store = useStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18nTyped();

const state = computed(() => parseUrlState(route.query));
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");
const nowUs = () => Date.now() * 1000;
const range = ref<K8sTime>({ start: nowUs() - DEFAULT_WINDOW_US, end: nowUs(), relative: true });
const dateTimePickerRef = ref<{ refresh?: () => void } | null>(null);

const k8s = useKubernetesInventory(
  () => state.value,
  () => range.value,
  () => orgId.value,
);
const { detection, pageError } = k8s;

const replace = (next: K8sUrlState) => router.replace({ query: toQuery(next, route.query) as any });
const push = (next: K8sUrlState) => router.push({ query: toQuery(next, route.query) as any });

const viewItem = (view: View, label: I18nKey) => ({
  key: view,
  label: t(label),
  to: { query: toQuery(withView(state.value, view), route.query) as any },
  dataTest: `k8s2-rail-${view}`,
});

const railGroups = computed<SectionHubGroup[]>(() => [
  {
    label: t("infra.k8s2.groupCluster"),
    items: [viewItem("cluster", "infra.k8s2.viewCluster"), viewItem("map", "infra.k8s2.viewMap")],
  },
  { label: raw(""), items: [viewItem("nodes", "infra.k8s2.viewNodes")] },
  {
    label: t("infra.k8s2.groupWorkloads"),
    items: [
      viewItem("workloads", "infra.k8s2.viewWorkloads"),
      viewItem("pods", "infra.k8s2.viewPods"),
      viewItem("deployments", "infra.k8s2.viewDeployments"),
      viewItem("daemonsets", "infra.k8s2.viewDaemonSets"),
      viewItem("statefulsets", "infra.k8s2.viewStatefulSets"),
      viewItem("replicasets", "infra.k8s2.viewReplicaSets"),
      viewItem("jobs", "infra.k8s2.viewJobs"),
      viewItem("cronjobs", "infra.k8s2.viewCronJobs"),
    ],
  },
  { label: t("infra.k8s2.groupStorage"), items: [viewItem("pvcs", "infra.k8s2.viewPvcs")] },
  { label: t("infra.k8s2.groupAutoscaling"), items: [viewItem("hpas", "infra.k8s2.viewHpas")] },
  {
    label: raw(""),
    items: [
      viewItem("namespaces", "infra.k8s2.viewNamespaces"),
      viewItem("events", "infra.k8s2.viewEvents"),
    ],
  },
]);

const ready = computed(() => detection.value === "detected" && !pageError.value);

const clusterOptions = computed(() => k8s.clusters.value.map((c) => ({ label: raw(c), value: c })));

const onCluster = (value: unknown) =>
  replace({ ...state.value, cluster: value ? String(value) : null, details: null });

const onUpdate = (patch: Partial<K8sUrlState>) => {
  const next = { ...state.value, ...patch };
  if (patch.entity && !ENTITY_FILLS[next.entity].includes(next.fill)) {
    next.fill = ENTITY_FILLS[next.entity][0];
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

const scopedRows = (rows: AnyRow[]) => {
  const cluster = k8s.effectiveCluster.value;
  return cluster == null ? rows : rows.filter((row) => row.cluster === cluster);
};

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

// What a load depends on; search and sort only re-filter rows already loaded.
const loadKey = computed(() => {
  const s = state.value;
  return JSON.stringify([s.view, s.cluster, s.namespaces, s.entity, s.group, s.details]);
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

const retryStreams = () => k8s.loadStreams({ force: true });

const retryPage = () => k8s.load({ force: true });

k8s.loadStreams();
</script>

<template>
  <OPageLayout :title="t('menu.kubernetes2')" icon="hub" bleed>
    <template #actions>
      <div class="flex items-center gap-2">
        <OSelect
          v-if="detection === 'detected' && clusterOptions.length"
          class="w-48 max-md:w-32"
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

    <template v-if="ready" #sidebar>
      <SectionRail :groups="railGroups" :active-key="state.view" />
    </template>

    <div
      v-if="detection === 'unknown'"
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

    <div v-else class="flex h-full min-h-0 flex-col" data-k8s2-body data-test="k8s2-body">
      <OBanner
        v-for="banner in k8s.banners.value"
        :key="banner.id"
        :variant="banner.variant"
        dense
        :content="t(banner.key, banner.params ?? {})"
        :data-test="`k8s2-banner-${banner.id}`"
      />
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <ClusterOverview
          v-if="state.view === 'cluster'"
          :inventory="k8s.inventory.value"
          :results="k8s.results.value"
          :warnings="k8s.warnings.value.rows"
          :cluster="k8s.effectiveCluster.value"
          :range="range"
          :refresh-nonce="k8s.refreshNonce.value"
          :has-stream="k8s.has"
          :loading="k8s.loading.value"
          :last-updated-at="k8s.lastUpdatedAt.value"
          @open="onOpen"
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
          @open="onOpen"
          @refresh="onRefresh"
        />
        <MapView
          v-else-if="state.view === 'map'"
          :state="state"
          :pods="scopedRows(k8s.inventory.value.pods) as any"
          :nodes="scopedRows(k8s.inventory.value.nodes) as any"
          :namespace-options="k8s.namespaceOptions.value"
          :anchor-missing="mapAnchor"
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
          :state="state"
          :end-us="range.end"
          :cluster="k8s.effectiveCluster.value"
          :event-links="k8s.eventLinksEnabled.value"
          :namespace-options="k8s.namespaceOptions.value"
          :loading="k8s.loading.value && !k8s.loaded.value"
          :forbidden="k8s.forbidden.value"
          :anchor-missing="k8s.anchorMissing(state.view)"
          :capped="state.view === 'events' && k8s.eventsCapped.value"
          :chip="unscopedChip"
          :last-updated-at="k8s.lastUpdatedAt.value"
          @open="onOpen"
          @update="onUpdate"
          @refresh="onRefresh"
        />
      </div>
    </div>

    <K8sDetailsDrawer
      v-if="ready && state.details"
      :details="state.details"
      :row="drawerRow"
      :inventory="k8s.inventory.value"
      :pending="k8s.detailLoading.value || !k8s.loaded.value"
      :observed="k8s.detailObserved.value"
      :has-events="k8s.hasEvents.value"
      :events-scoped="k8s.eventsScoped.value"
      :events="k8s.detailEvents.value"
      :range="range"
      :refresh-nonce="k8s.refreshNonce.value"
      :org-id="orgId"
      :has-stream="k8s.has"
      :anchor="BODY_ANCHOR"
      @close="closeDetails"
      @open="onDrawerLink"
    />
  </OPageLayout>
</template>
