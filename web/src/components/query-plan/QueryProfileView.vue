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
  <div
    class="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_27.5rem] max-md:flex max-md:flex-col max-md:overflow-y-auto"
    data-test="query-profile-view"
  >
    <div class="relative flex min-h-0 min-w-0 flex-col max-md:shrink-0">
      <aside
        ref="panelEl"
        class="bg-surface-base border-border-default rounded-surface absolute start-3 top-3 z-20 max-h-[calc(100%-1.5rem)] w-75 overflow-y-auto border p-3 shadow-md max-md:static max-md:max-h-none max-md:w-auto max-md:rounded-none max-md:border-0 max-md:border-b max-md:px-4 max-md:shadow-none"
      >
        <ProfileSummaryPanel
          :model="model"
          :summary="summary"
          :scope="scope"
          :selected-id="selectedId"
          @select="selectedId = $event"
          @scope="scope = $event"
        />
      </aside>
      <div class="min-h-0 flex-1 max-md:h-[78vh] max-md:flex-none">
        <ProfileCanvas
          :model="model"
          :layout="layout"
          :scope="scope"
          :selected-id="selectedId"
          :left-inset="leftInset"
          @select="selectedId = $event"
        >
          <template v-if="model.stages.length" #toolbar>
            <div
              class="bg-surface-base border-border-default rounded-default flex items-center gap-1.5 border p-1 whitespace-nowrap shadow-sm"
              data-test="query-profile-scope-toolbar"
            >
              <span class="text-text-secondary ps-1.5 text-xs max-md:hidden">{{
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
      </div>
    </div>
    <aside
      class="bg-surface-base border-border-default min-h-0 overflow-y-auto border-s max-md:shrink-0 max-md:overflow-visible max-md:border-s-0 max-md:border-t"
    >
      <ProfileDetailPanel
        :model="model"
        :op-id="selectedId"
        :scope="scope"
        @select="selectedId = $event"
        @scope="scope = $event"
      />
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import useBreakpoint from "@/composables/useBreakpoint";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  buildProfileModel,
  clusterNodes,
  layoutProfile,
  nodeScope,
  scopeNodeKey,
  summarizeProfile,
  type QueryProfile,
  type SearchStreamResult,
  type StageScope,
} from "@/utils/queryProfile";
import ProfileCanvas from "./ProfileCanvas.vue";
import ProfileDetailPanel from "./ProfileDetailPanel.vue";
import ProfileSummaryPanel from "./ProfileSummaryPanel.vue";
import { roleLabel } from "./profileText";

const MOBILE_INSET = 16;
const PANEL_GAP = 24;

const props = defineProps<{
  profile: QueryProfile;
  stream?: Partial<SearchStreamResult> | null;
}>();

const { t } = useI18nTyped();
const { isMobile } = useBreakpoint();

const panelEl = ref<HTMLElement | null>(null);
const panelWidth = ref(0);
const scope = ref<StageScope>("sum");
const selectedId = ref<string | null>(null);

const model = computed(() => buildProfileModel(props.profile, props.stream?.hits ?? []));
const layout = computed(() => layoutProfile(model.value));
const summary = computed(() => summarizeProfile(model.value, props.stream ?? {}));

const nodeOptions = computed(() =>
  clusterNodes(model.value).map((n) => {
    const role = roleLabel(t, n.role);
    return { label: raw(role ? `${n.name} · ${role}` : n.name), value: n.key };
  }),
);

const selectedNode = computed(() => scopeNodeKey(scope.value));
const toggleValue = computed(() => (selectedNode.value ? "" : scope.value));
const leftInset = computed(() => (isMobile.value ? MOBILE_INSET : panelWidth.value + PANEL_GAP));

function onToggle(value: unknown) {
  if (value === "sum" || value === "max") scope.value = value;
}

function onNodeSelect(value: SelectModelValue) {
  scope.value = typeof value === "string" && value ? nodeScope(value) : "sum";
}

watch(
  model,
  (m) => {
    selectedId.value = summary.value.hotspots[0] ?? m.rootId;
    scope.value = "sum";
  },
  { immediate: true },
);

onMounted(() => {
  panelWidth.value = panelEl.value?.offsetWidth ?? 0;
});
</script>
