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

<template>
  <QueryPlanLayout data-test="query-profile-view">
    <template #summary>
      <ProfileSummaryPanel
        :model="viewModel"
        :clusters="clusters"
        :cluster-view="clusterView"
        :summary="summary"
        :scope="scope"
        :selected-id="selectedId"
        @select="pick"
        @scope="scope = $event"
        @cluster="clusterView = $event"
      />
    </template>
    <template #canvas="{ leftInset }">
      <ProfileCanvas
        :model="viewModel"
        :layout="layout"
        :scope="scope"
        :selected-id="selectedId"
        :left-inset="leftInset"
        :plumbing="fold.plumbing"
        :notice="nodeNotice ?? clusterNotice ?? notice"
        @select="pick"
        @fold="act"
        @notice-action="onCanvasNotice"
      />
    </template>
    <template #detail>
      <ProfileDetailPanel
        :model="viewModel"
        :op-id="selectedId"
        :scope="scope"
        @select="pick"
        @scope="scope = $event"
      />
    </template>
  </QueryPlanLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  clusterSummary,
  modelForClusterView,
  scopeNodeKey,
  summarizeProfile,
  type ClusterView,
  type ProfileModel,
  type SearchStreamResult,
  type StageScope,
} from "@/utils/queryProfile";
import ProfileCanvas from "./ProfileCanvas.vue";
import ProfileDetailPanel from "./ProfileDetailPanel.vue";
import ProfileSummaryPanel from "./ProfileSummaryPanel.vue";
import type { FoldNotice } from "./profileStyles";
import QueryPlanLayout from "./QueryPlanLayout.vue";
import { nodeName } from "./profileText";
import { useProfileFold } from "./useProfileFold";

const props = defineProps<{
  model: ProfileModel;
  stream?: Partial<SearchStreamResult> | null;
}>();

const { t } = useI18nTyped();

const scope = ref<StageScope>("sum");
const clusterView = ref<ClusterView>("all");

const clusters = computed(() => clusterSummary(props.model));
const viewModel = computed(() => modelForClusterView(props.model, clusterView.value));
const summary = computed(() => summarizeProfile(viewModel.value, props.stream ?? {}));
const { selectedId, fold, layout, notice, act, onNoticeAction, pick } = useProfileFold(
  t,
  () => viewModel.value,
  (m) => summarizeProfile(m, props.stream ?? {}).hotspots[0] ?? m.rootId,
);

const clusterNotice = computed<FoldNotice | null>(() => {
  if (clusterView.value === "all" || !clusters.value) return null;
  const action = t("search.queryProfile.showAllClusters");
  const cluster = clusterView.value.slice("cluster:".length);
  const row = clusters.value.rows.find((r) => r.name === cluster);
  const total = clusters.value.rows.reduce((a, r) => a + r.queriers + r.ingesters, 0);
  const count = row ? row.queriers + row.ingesters : 0;
  return { text: t("search.queryProfile.oneClusterNote", { cluster, count, total }), action };
});

const nodeNotice = computed<FoldNotice | null>(() => {
  const key = scopeNodeKey(scope.value);
  if (!key) return null;
  const node = raw(nodeName(viewModel.value, key));
  return {
    text: t("search.queryProfile.nodeScopeNote", { node }),
    action: t("search.queryProfile.showAllNodes"),
    keepView: true,
  };
});

function onCanvasNotice() {
  if (nodeNotice.value) scope.value = "sum";
  else if (clusterNotice.value) clusterView.value = "all";
  else onNoticeAction();
}

watch(
  () => props.model,
  () => (clusterView.value = "all"),
);

watch(viewModel, () => (scope.value = "sum"));
</script>
