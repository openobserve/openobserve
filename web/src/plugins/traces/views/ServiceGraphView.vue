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
along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  Standalone Service Graph route (`/traces/service-graph`).

  Header follows the Agent Graph page exactly — OPageLayout with
  title/subtitle/icon, a DateTime picker in #actions, and an ORefreshButton
  showing the last run time in the same bordered box (see
  enterprise/components/AIObservability/AiPageShell.vue). AiPageShell itself is
  not reused: it is bound to the AI section's `useAiDateRange` state, whereas
  the graph reads the shared traces datetime.

  The graph-specific controls (view type, layout) sit right-aligned in the
  #subnav strip, matching the Agent Graph page's #trailing slot.
-->
<template>
  <OPageLayout
    data-test="service-graph-page"
    :title="t('menu.serviceGraph')"
    :subtitle="t('traces.serviceGraphSubtitle')"
    icon="share"
    bleed
    :scroll="false"
  >
    <template #actions>
      <DateTime
        auto-apply
        menu-align="end"
        :default-type="searchObj.data.datetime.type"
        :default-absolute-time="{
          startTime: searchObj.data.datetime.startTime,
          endTime: searchObj.data.datetime.endTime,
        }"
        :default-relative-time="searchObj.data.datetime.relativeTimePeriod"
        data-test="service-graph-date-time-picker"
        class="h-8"
        @on:date-change="onDateChange"
      />
      <div
        class="border-border-default rounded-default inline-flex h-8 items-center overflow-hidden border px-1"
      >
        <ORefreshButton
          :last-run-at="graphRef?.lastRunAt ?? null"
          :loading="graphRef?.loading ?? false"
          :disabled="graphRef?.loading ?? false"
          data-test="service-graph-refresh-btn"
          @click="graphRef?.refresh()"
        />
      </div>
    </template>

    <!-- Subnav row — same shape as the Agent Graph page: page-scope controls on
         the left, view-type + layout pushed to the right corner with ml-auto. -->
    <template #subnav>
      <!-- < md the row wraps: scope+search line, then view controls. -->
      <div class="px-page-edge flex items-center gap-2 py-1.5 max-md:flex-wrap max-md:gap-y-1">
        <!-- Stream scope + search on the left. Both are hidden inside the graph
             (`hide-stream-selector` / `hide-search-input`) so each renders once,
             here on this row. -->
        <div data-test="service-graph-stream-selector" class="w-44 flex-shrink-0">
          <OSelect
            :model-value="selectedStream"
            :options="streamOptions"
            labelKey="label"
            valueKey="value"
            class="rounded-default w-full"
            :disabled="streamOptions.length === 0"
            @update:model-value="onStreamPick"
          />
        </div>
        <div data-test="service-graph-search-input" class="flex-shrink-0">
          <OSearchInput
            v-model="searchText"
            class="w-56! max-md:w-40!"
            :placeholder="t('traces.serviceGraph.searchPlaceholder')"
            :debounce="300"
            clearable
            @update:model-value="onSearchChange"
          />
        </div>
        <div class="ml-auto flex shrink-0 items-center gap-2 max-md:w-full max-md:justify-end">
          <OToggleGroup
            :model-value="searchObj.meta.serviceGraphVisualizationType"
            type="single"
            @update:model-value="onVisualizationChange($event as 'tree' | 'graph')"
          >
            <OToggleGroupItem data-test="service-graph-tree-view-btn" value="tree" size="sm">
              <template #icon-left><OIcon name="git-branch" size="sm" /></template>
              {{ t("traces.treeView") }}
            </OToggleGroupItem>
            <OToggleGroupItem data-test="service-graph-graph-view-btn" value="graph" size="sm">
              <template #icon-left><OIcon name="share" size="sm" class="shrink-0" /></template>
              {{ t("traces.graphView") }}
            </OToggleGroupItem>
          </OToggleGroup>
          <OSelect
            v-model="searchObj.meta.serviceGraphLayoutType"
            :options="layoutOptions"
            :searchable="false"
            data-test="service-graph-layout-type"
            class="h-8! min-h-8! w-[7.5rem] max-md:w-24!"
            :disabled="searchObj.meta.serviceGraphVisualizationType === 'graph'"
            @update:model-value="onLayoutChange"
          />
        </div>
      </div>
    </template>

    <div class="h-full min-h-0">
      <ServiceGraph
        ref="graphRef"
        hide-stream-selector
        hide-search-input
        @view-traces="onViewTraces"
        @request:stream-change="onStreamChange"
        @jump-to-stream-data="onJumpToStreamData"
      />
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import DateTime from "@/components/DateTime.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import useStreams from "@/composables/useStreams";
import useTraces from "@/composables/useTraces";
import { viewTracesQuery, type ViewTracesPayload } from "../viewTracesHandoff";
import { applyUrlTimeRange } from "./useServiceViewTimeRange";

const ServiceGraph = defineAsyncComponent(() => import("../ServiceGraph.vue"));

const { t } = useI18nTyped();
const graphRef = ref<any>(null);
const router = useRouter();
const store = useStore();
const { searchObj } = useTraces();
const { getStreams } = useStreams(t);

// Stream list is loaded here rather than read off the graph: `expose()` unwraps
// refs, so `graphRef.value.availableStreams` is a snapshot the template would
// never see update.
const availableStreams = ref<string[]>([]);
const selectedStream = ref("");
const streamOptions = computed(() =>
  availableStreams.value.map((s) => ({ label: raw(s), value: s })),
);

// The Traces page sets this inside loadPageData(); on these standalone routes
// nothing else does, and an empty org produces requests to `/api//_search`.
searchObj.organizationIdentifier = store.state.selectedOrganization?.identifier ?? "";
watch(
  () => store.state.selectedOrganization?.identifier,
  (id) => {
    if (id) searchObj.organizationIdentifier = id;
  },
);

// Honour ?period= / ?from=&to= before the graph queries (these routes are
// deep-linked by tests and by shared links).
applyUrlTimeRange(router, searchObj.data.datetime);

onMounted(async () => {
  try {
    const res: any = await getStreams("traces", false, false);
    if (res?.list?.length) availableStreams.value = res.list.map((x: any) => x.name);
  } catch (e) {
    console.error("Error loading trace streams:", e);
  }
  // Resolve the same way ServiceGraph does internally, so the picker opens on
  // the stream that is actually drawn.
  selectedStream.value =
    searchObj.data.stream?.selectedStream?.value ||
    localStorage.getItem("serviceGraph_streamFilter") ||
    "default";
});

const searchText = ref("");
function onSearchChange(value: any) {
  graphRef.value?.setSearchFilter(String(value ?? ""));
}

function onStreamPick(stream: any) {
  const name = String(stream ?? "");
  if (!name) return;
  selectedStream.value = name;
  graphRef.value?.onStreamFilterChange(name);
}

const layoutOptions = computed(() =>
  searchObj.meta.serviceGraphVisualizationType === "graph"
    ? [{ label: t("traces.layoutForce"), value: "force" }]
    : [
        { label: t("traces.layoutHorizontal"), value: "horizontal" },
        { label: t("traces.layoutVertical"), value: "vertical" },
      ],
);

/**
 * Hand off to the Traces route. The filter, stream, mode and time range travel
 * as query params (see `viewTracesQuery`) rather than as a mutation of the
 * shared store, so the resulting URL is bookmarkable and survives a reload.
 */
function onViewTraces(data: string | ViewTracesPayload) {
  router.push({
    name: "traces",
    query: {
      org_identifier: router.currentRoute.value.query.org_identifier,
      ...viewTracesQuery(data),
    },
  });
}

/**
 * Write the picked range into the shared traces datetime; the graph watches it
 * and reloads itself.
 */
function onDateChange(value: any) {
  searchObj.data.datetime = {
    startTime: value.startTime,
    endTime: value.endTime,
    relativeTimePeriod: value.relativeTimePeriod
      ? value.relativeTimePeriod
      : searchObj.data.datetime.relativeTimePeriod,
    type: value.relativeTimePeriod ? "relative" : "absolute",
  };
}

function onVisualizationChange(type: "tree" | "graph") {
  searchObj.meta.serviceGraphVisualizationType = type;
  localStorage.setItem("serviceGraph_visualizationType", type);
  const newLayout = type === "tree" ? "horizontal" : "force";
  searchObj.meta.serviceGraphLayoutType = newLayout;
  localStorage.setItem("serviceGraph_layoutType", newLayout);
}

function onLayoutChange(type: any) {
  searchObj.meta.serviceGraphLayoutType = String(type);
  localStorage.setItem("serviceGraph_layoutType", String(type));
}

/**
 * On its own route there is no traces query editor to invalidate, so a stream
 * change applies directly — no "you will lose your query" confirmation.
 */
function onStreamChange(newStream: string) {
  searchObj.data.stream.selectedStream = { label: newStream, value: newStream };
}

function onJumpToStreamData(fromUs: number, toUs: number) {
  searchObj.data.datetime.startTime = fromUs;
  searchObj.data.datetime.endTime = toUs;
  searchObj.data.datetime.type = "absolute";
  searchObj.data.datetime.relativeTimePeriod = "";
}
</script>
