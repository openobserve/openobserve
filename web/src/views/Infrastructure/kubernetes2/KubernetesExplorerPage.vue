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
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem, StatTone } from "@/lib/data/StatStrip/OStatStrip.types";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import DateTime from "@/components/DateTime.vue";
import DataSourceSetupCard from "@/components/ingestion/setupCard/DataSourceSetupCard.vue";
import PodsTable from "./PodsTable.vue";
import NodesTable from "./NodesTable.vue";
import DeploymentsTable from "./DeploymentsTable.vue";
import PodDetailDrawer from "./PodDetailDrawer.vue";
import { useKubernetesInventory } from "./useKubernetesInventory";
import { ISSUE_KIND, type IssueKey, type K8sKind } from "./kubernetesQueries";
import type { DeploymentRow, NodeRow, PodRow } from "./kubernetesModel";
import {
  encodeCompound,
  isCanonical,
  parseListState,
  stripListParams,
  toQuery,
  withFilter,
  withKind,
  withTile,
  type K8sListState,
} from "./kubernetesUrlState";

const DEFAULT_RELATIVE_PERIOD = "1h";
const DEFAULT_WINDOW_US = 60 * 60 * 1000 * 1000;

const ISSUE_TONE: Record<IssueKey, StatTone> = {
  podsNotRunning: "error",
  podsContainerErrors: "error",
  podsOomKilled: "error",
  podsRestarting: "warning",
  podsNearMemoryLimit: "warning",
  nodesNotReady: "error",
  nodesPressure: "warning",
  deploymentsUnavailable: "error",
};

const ISSUE_LABEL: Record<IssueKey, I18nKey> = {
  podsNotRunning: "infra.k8s2.podsNotRunning",
  podsContainerErrors: "infra.k8s2.podsContainerErrors",
  podsOomKilled: "infra.k8s2.podsOomKilled",
  podsRestarting: "infra.k8s2.podsRestarting",
  podsNearMemoryLimit: "infra.k8s2.podsNearMemoryLimit",
  nodesNotReady: "infra.k8s2.nodesNotReady",
  nodesPressure: "infra.k8s2.nodesPressure",
  deploymentsUnavailable: "infra.k8s2.deploymentsUnavailable",
};

const store = useStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18nTyped();

const state = computed(() => parseListState(route.query));
const k8s = useKubernetesInventory(() => state.value);
const { detection, pageError, loading, counts, banners } = k8s;

const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");
const nowUs = () => Date.now() * 1000;
const range = ref({ start: nowUs() - DEFAULT_WINDOW_US, end: nowUs() });
const dateTimePickerRef = ref<{ refresh?: () => void } | null>(null);

// A flat route remounts, so every piece of list state lives in the URL.
const writeState = (next: K8sListState) =>
  router.replace({ query: toQuery(next, route.query) as Record<string, any> });

const refreshList = () =>
  k8s.refresh({
    orgId: orgId.value,
    start: range.value.start,
    end: range.value.end,
    kind: state.value.kind,
  });

// Set while picker.refresh() runs so its programmatic re-emit may fetch; the mount replay must not.
let reAnchoring = false;
let reAnchorFetched = false;

const onRefreshClick = () => {
  const picker = dateTimePickerRef.value;
  reAnchoring = true;
  reAnchorFetched = false;
  try {
    picker?.refresh?.();
  } finally {
    reAnchoring = false;
  }
  if (!reAnchorFetched && detection.value === "detected") refreshList();
};

const onDateChange = (date: { startTime: number; endTime: number; userChangedValue?: boolean }) => {
  range.value = { start: date.startTime, end: date.endTime };
  if (date.userChangedValue === false && !reAnchoring) return;
  if (reAnchoring) reAnchorFetched = true;
  if (detection.value === "detected") refreshList();
};

watch(
  () => state.value.kind,
  (kind, prev) => {
    if (kind !== prev && detection.value === "detected") refreshList();
  },
);

watch(detection, (next, prev) => {
  if (next === "detected" && prev !== "detected") refreshList();
});

watch(
  () => store.state.selectedOrganization?.identifier,
  async (next, prev) => {
    if (!next || next === prev) return;
    await router.replace({ query: stripListParams(route.query) as Record<string, any> });
    const wasDetected = detection.value === "detected";
    await k8s.loadStreams({ force: true });
    if (wasDetected && detection.value === "detected") refreshList();
  },
);

onMounted(() => {
  if (!isCanonical(route.query)) writeState(state.value);
  k8s.loadStreams();
});

const retryStreams = () => k8s.loadStreams({ force: true });

const scopeChip = computed(() =>
  k8s.scopeCluster.value
    ? t("infra.k8s2.scopeCluster", { name: raw(k8s.scopeCluster.value) })
    : t("infra.k8s2.scopeAllClusters"),
);

const visibleBanners = computed(() =>
  banners.value.filter((banner) => banner.kind == null || banner.kind === state.value.kind),
);

const tiles = computed<StatItem[]>(() => {
  const items: StatItem[] = [
    {
      key: "all",
      label: t("infra.k8s2.tileAll"),
      value: k8s.scopedCount.value,
      dataTest: "k8s2-tile-all",
    },
  ];
  for (const key of Object.keys(ISSUE_KIND) as IssueKey[]) {
    const count = counts.value[key];
    if (count == null) continue;
    items.push({
      key,
      label: t(ISSUE_LABEL[key]),
      value: count,
      tone: count > 0 ? ISSUE_TONE[key] : "neutral",
      dataTest: `k8s2-tile-${key}`,
    });
  }
  return items;
});

const onTile = (key: string) => writeState(withTile(state.value, key as IssueKey | "all"));

const onKind = (kind: string | number) => writeState(withKind(state.value, kind as K8sKind));

const onName = (name: string) => {
  if (name !== state.value.name) writeState(withFilter(state.value, { name }));
};

const clusterChoice = computed(() =>
  state.value.cluster === "*" ? "*" : (k8s.effectiveCluster.value ?? "*"),
);
const onCluster = (value: string | number | boolean) =>
  writeState(withFilter(state.value, { cluster: String(value) }));

const onNamespace = (value: string | number | boolean) =>
  writeState(withFilter(state.value, { namespace: value ? String(value) : null }));

const onSort = (sort: string, desc: boolean) => writeState({ ...state.value, sort, desc });
const onPage = (page: number) => writeState({ ...state.value, page });

const podsOnNode = (cluster: string, node: string) =>
  writeState(withFilter(withKind(state.value, "pods"), { onNode: [cluster, node], pod: null }));

const podsOfOwner = (cluster: string, namespace: string, kind: string, name: string) =>
  writeState(
    withFilter(withKind(state.value, "pods"), {
      workload: [cluster, namespace, kind, name],
      pod: null,
    }),
  );

const openPod = (row: PodRow) =>
  writeState({ ...state.value, pod: [row.cluster, row.namespace, row.name] });
const closePod = () => writeState({ ...state.value, pod: null });

const onPodNode = (row: PodRow) => row.node && podsOnNode(row.cluster, row.node);
const onPodOwner = (row: PodRow) =>
  row.owner && podsOfOwner(row.cluster, row.namespace, row.owner.kind, row.owner.name);
const onNodeRow = (row: NodeRow) => podsOnNode(row.cluster, row.name);
const onDeploymentRow = (row: DeploymentRow) =>
  podsOfOwner(row.cluster, row.namespace, "Deployment", row.name);

const drawerPod = computed(() =>
  state.value.pod ? k8s.podByKey(encodeCompound(state.value.pod)) : null,
);

const multiCluster = computed(
  () => k8s.scopeCluster.value == null && k8s.clusters.value.length > 1,
);

const tableProps = computed(() => ({
  total: k8s.rows.value.length,
  page: k8s.page.value,
  sortBy: state.value.sort ?? "name",
  desc: state.value.desc,
  loading: loading.value,
}));
</script>

<template>
  <OPageLayout :title="t('menu.kubernetes2')" icon="hub" bleed>
    <template #actions>
      <div class="flex items-center gap-2">
        <OTag
          v-if="detection === 'detected'"
          variant="default-soft"
          size="sm"
          data-test="k8s2-scope-cluster"
          >{{ scopeChip }}</OTag
        >
        <OTag
          v-if="detection === 'detected' && state.namespace"
          variant="default-soft"
          size="sm"
          data-test="k8s2-scope-namespace"
          >{{ t("infra.k8s2.scopeNamespace", { name: raw(state.namespace) }) }}</OTag
        >
        <DateTime
          ref="dateTimePickerRef"
          auto-apply
          menu-align="end"
          default-type="relative"
          :default-relative-time="DEFAULT_RELATIVE_PERIOD"
          data-test-name="k8s2-date-time"
          @on:date-change="onDateChange"
        />
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="refresh"
          class="max-md:min-w-0 max-md:ps-2 max-md:pe-2"
          data-test="k8s2-refresh"
          :loading="loading"
          @click="onRefreshClick"
        >
          <span class="max-md:sr-only">{{ t("infra.k8s2.refresh") }}</span>
        </OButton>
      </div>
    </template>

    <div
      v-if="detection === 'unknown'"
      class="flex min-h-60 items-center justify-center"
      data-test="k8s2-spinner"
    >
      <OSpinner size="lg" />
    </div>

    <div
      v-else-if="detection === 'error'"
      class="flex min-h-60 flex-col items-center justify-center gap-2"
      data-test="k8s2-streams-error"
    >
      <OText class="text-lg font-semibold">{{ t("infra.k8s2.streamsError") }}</OText>
      <OButton
        variant="outline"
        size="sm-action"
        data-test="k8s2-streams-retry"
        @click="retryStreams"
      >
        {{ t("infra.k8s2.retry") }}
      </OButton>
    </div>

    <div v-else-if="detection === 'undetected'" class="min-h-0 flex-1 overflow-y-auto">
      <div
        class="max-lg:px-page-edge mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-3 py-6"
        data-test="k8s2-empty-state"
      >
        <OText tag="h2" class="text-xl font-semibold">{{ t("infra.k8s2.emptyHeadline") }}</OText>
        <DataSourceSetupCard slug="kubernetes" @detected="retryStreams" />
      </div>
    </div>

    <div
      v-else-if="pageError"
      class="flex min-h-60 flex-col items-center justify-center gap-2"
      data-test="k8s2-page-error"
    >
      <OText class="text-lg font-semibold">{{ t("infra.k8s2.pageError") }}</OText>
      <OText variant="meta">{{ raw(pageError) }}</OText>
      <OButton variant="outline" size="sm-action" data-test="k8s2-retry" @click="refreshList">
        {{ t("infra.k8s2.retry") }}
      </OButton>
    </div>

    <div v-else class="flex h-full min-h-0 flex-col gap-2">
      <OBanner
        v-for="banner in visibleBanners"
        :key="banner.id"
        variant="warning"
        dense
        :content="t(banner.key, banner.params ?? {})"
        :data-test="`k8s2-banner-${banner.id}`"
      />

      <OStatStrip
        :items="tiles"
        selectable
        :selected-key="state.issue ?? 'all'"
        default-key="all"
        data-test="k8s2-tiles"
        @select="onTile"
      />

      <OTabs
        :model-value="state.kind"
        class="border-border-default border-b"
        data-test="k8s2-tabs"
        @update:model-value="onKind"
      >
        <OTab name="pods" :label="t('infra.k8s2.tabPods')" data-test="k8s2-tab-pods" />
        <OTab name="nodes" :label="t('infra.k8s2.tabNodes')" data-test="k8s2-tab-nodes" />
        <OTab
          name="deployments"
          :label="t('infra.k8s2.tabDeployments')"
          data-test="k8s2-tab-deployments"
        />
      </OTabs>

      <div class="flex min-h-0 flex-1">
        <div
          class="w-rail bg-surface-panel border-border-default flex h-full shrink-0 flex-col gap-3 overflow-y-auto border-e px-1.5 py-2"
        >
          <OSearchInput
            :model-value="state.name"
            :debounce="300"
            :placeholder="t('infra.k8s2.filterPlaceholder')"
            data-test="k8s2-name-filter"
            @update:model-value="onName"
          />
          <section v-if="k8s.clusterFacet.value.length" class="flex flex-col gap-1">
            <OText variant="label" class="px-1 font-semibold">{{
              t("infra.k8s2.clusterFacet")
            }}</OText>
            <ORadioGroup
              :model-value="clusterChoice"
              data-test="k8s2-cluster-facet"
              @update:model-value="onCluster"
            >
              <ORadio value="*" size="sm" :label="t('infra.k8s2.facetAll')" />
              <ORadio
                v-for="facet in k8s.clusterFacet.value"
                :key="facet.value"
                :value="facet.value"
                size="sm"
              >
                <template #label>
                  <span class="flex min-w-0 items-center justify-between gap-2">
                    <span class="truncate text-xs">{{ raw(facet.value) }}</span>
                    <OTag type="countChip" value="neutral" size="xs" shape="rounded">{{
                      facet.count
                    }}</OTag>
                  </span>
                </template>
              </ORadio>
            </ORadioGroup>
          </section>
          <section v-if="state.kind !== 'nodes'" class="flex flex-col gap-1">
            <OText variant="label" class="px-1 font-semibold">{{
              t("infra.k8s2.namespaceFacet")
            }}</OText>
            <ORadioGroup
              :model-value="state.namespace ?? ''"
              data-test="k8s2-namespace-facet"
              @update:model-value="onNamespace"
            >
              <ORadio value="" size="sm" :label="t('infra.k8s2.facetAll')" />
              <ORadio
                v-for="facet in k8s.namespaceFacet.value"
                :key="facet.value"
                :value="facet.value"
                size="sm"
              >
                <template #label>
                  <span class="flex min-w-0 items-center justify-between gap-2">
                    <span class="truncate text-xs">{{ raw(facet.value) }}</span>
                    <OTag type="countChip" value="neutral" size="xs" shape="rounded">{{
                      facet.count
                    }}</OTag>
                  </span>
                </template>
              </ORadio>
            </ORadioGroup>
          </section>
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-2">
          <div
            v-if="state.kind === 'pods' && (state.onNode || state.workload)"
            class="flex flex-wrap items-center gap-2 px-2 pt-2"
          >
            <OButton
              v-if="state.onNode"
              variant="outline"
              size="xs"
              icon-right="close"
              :title="t('infra.k8s2.clearFilter')"
              data-test="k8s2-filter-node"
              @click="writeState(withFilter(state, { onNode: null }))"
              >{{ t("infra.k8s2.filterNode", { name: raw(state.onNode[1]) }) }}</OButton
            >
            <OButton
              v-if="state.workload"
              variant="outline"
              size="xs"
              icon-right="close"
              :title="t('infra.k8s2.clearFilter')"
              data-test="k8s2-filter-workload"
              @click="writeState(withFilter(state, { workload: null }))"
              >{{
                t("infra.k8s2.filterWorkload", {
                  name: raw(`${state.workload[2]}/${state.workload[3]}`),
                })
              }}</OButton
            >
          </div>
          <div class="min-h-0 flex-1">
            <PodsTable
              v-if="state.kind === 'pods'"
              :rows="k8s.pagedRows.value as PodRow[]"
              v-bind="tableProps"
              @sort="onSort"
              @page="onPage"
              @open="openPod"
              @filter-node="onPodNode"
              @filter-owner="onPodOwner"
            />
            <NodesTable
              v-else-if="state.kind === 'nodes'"
              :rows="k8s.pagedRows.value as NodeRow[]"
              v-bind="tableProps"
              @sort="onSort"
              @page="onPage"
              @open="onNodeRow"
            />
            <DeploymentsTable
              v-else
              :rows="k8s.pagedRows.value as DeploymentRow[]"
              v-bind="tableProps"
              @sort="onSort"
              @page="onPage"
              @open="onDeploymentRow"
            />
          </div>
        </div>
      </div>
    </div>

    <PodDetailDrawer
      v-if="state.pod && detection === 'detected'"
      :target="state.pod"
      :pod="drawerPod"
      :range="range"
      :org-id="orgId"
      :multi-cluster="multiCluster"
      :usage-streams="k8s.podUsageStreams.value"
      @close="closePod"
      @filter-node="onPodNode"
      @filter-owner="onPodOwner"
    />
  </OPageLayout>
</template>
