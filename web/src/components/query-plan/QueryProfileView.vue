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
        :model="model"
        :summary="summary"
        :scope="scope"
        :selected-id="selectedId"
        @select="pick"
        @scope="scope = $event"
      />
    </template>
    <template #canvas="{ leftInset }">
      <ProfileCanvas
        ref="canvasRef"
        :model="model"
        :layout="layout"
        :scope="scope"
        :selected-id="selectedId"
        :left-inset="leftInset"
        :plumbing="fold.plumbing"
        :notice="notice"
        @select="pick"
        @fold="act"
        @notice-action="onNoticeAction"
      >
        <template v-if="model.stages.length" #toolbar>
          <div
            class="bg-surface-base border-border-default rounded-default flex items-center gap-1.5 border p-1 whitespace-nowrap shadow-sm"
            data-test="query-profile-scope-toolbar"
          >
            <span class="text-text-secondary ps-1.5 text-xs max-xl:hidden">{{
              t("search.queryProfile.stageMetrics")
            }}</span>
            <OToggleGroup
              type="single"
              :model-value="toggleValue"
              :aria-label="t('search.queryProfile.stageMetrics')"
              @update:model-value="onToggle"
            >
              <OToggleGroupItem value="sum" size="sm" data-test="query-profile-scope-sum">{{
                t("search.queryProfile.scopeSum")
              }}</OToggleGroupItem>
              <OToggleGroupItem value="max" size="sm" data-test="query-profile-scope-max">{{
                t("search.queryProfile.scopeMax")
              }}</OToggleGroupItem>
            </OToggleGroup>
            <div class="w-40">
              <OSelect
                :model-value="selectedNode"
                :options="nodeOptions"
                size="sm"
                searchable
                clearable
                :placeholder="t('search.queryProfile.scopeNode')"
                data-test="query-profile-scope-node"
                @update:model-value="onNodeSelect"
              />
            </div>
          </div>
        </template>
      </ProfileCanvas>
    </template>
    <template #detail>
      <ProfileDetailPanel
        :model="model"
        :op-id="selectedId"
        :scope="scope"
        :can-focus="focusable"
        :focused="!!fold.focusId && fold.focusId === selectedId"
        @select="pick"
        @scope="scope = $event"
        @focus="focusOn"
      />
    </template>
  </QueryPlanLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  clusterNodes,
  nodeScope,
  scopeNodeKey,
  summarizeProfile,
  type ProfileModel,
  type SearchStreamResult,
  type StageScope,
} from "@/utils/queryProfile";
import ProfileCanvas from "./ProfileCanvas.vue";
import ProfileDetailPanel from "./ProfileDetailPanel.vue";
import ProfileSummaryPanel from "./ProfileSummaryPanel.vue";
import QueryPlanLayout, { revealDetail } from "./QueryPlanLayout.vue";
import { roleLabel } from "./profileText";
import { useProfileFold } from "./useProfileFold";

const props = defineProps<{
  model: ProfileModel;
  stream?: Partial<SearchStreamResult> | null;
}>();

const { t } = useI18nTyped();

const scope = ref<StageScope>("sum");
const selectedId = ref<string | null>(null);
const canvasRef = ref<InstanceType<typeof ProfileCanvas> | null>(null);

const summary = computed(() => summarizeProfile(props.model, props.stream ?? {}));
const { fold, layout, notice, focusable, act, reveal, onNoticeAction } = useProfileFold(
  t,
  () => props.model,
  selectedId,
);

const nodeOptions = computed(() =>
  clusterNodes(props.model).map((n) => {
    const role = roleLabel(t, n.role);
    return { label: raw([n.name, n.cluster, role].filter(Boolean).join(" · ")), value: n.key };
  }),
);

const selectedNode = computed(() => scopeNodeKey(scope.value));
const toggleValue = computed(() => (selectedNode.value ? "" : scope.value));

function pick(id: string) {
  reveal(id);
  selectedId.value = id;
  revealDetail();
}

function focusOn(opId: string | null) {
  canvasRef.value?.fitNext();
  act({ type: "focus", opId });
}

function onToggle(value: unknown) {
  if (value === "sum" || value === "max") scope.value = value;
}

function onNodeSelect(value: SelectModelValue) {
  scope.value = typeof value === "string" && value ? nodeScope(value) : "sum";
}

watch(
  () => props.model,
  (m) => {
    selectedId.value = summary.value.hotspots[0] ?? m.rootId;
    scope.value = "sum";
  },
  { immediate: true },
);
</script>
