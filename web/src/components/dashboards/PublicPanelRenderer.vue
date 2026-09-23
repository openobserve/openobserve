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
  <div ref="chartPanelRef" class="relative h-full">
    <TableRenderer
      v-if="panelSchema.type == 'table'"
      :data="tableRendererData"
      :value-mapping="panelSchema?.config?.mappings ?? []"
      :wrap-cells="panelSchema.config?.wrap_table_cells"
      :show-pagination="panelSchema.config?.table_pagination"
      :rows-per-page="panelSchema.config?.table_pagination_rows_per_page"
    />
    <HTMLRenderer
      v-else-if="panelSchema.type == 'html'"
      :htmlContent="panelSchema.htmlContent"
      :panelId="panelSchema.id"
    />
    <MarkdownRenderer
      v-else-if="panelSchema.type == 'markdown'"
      :markdownContent="panelSchema.markdownContent"
      :panelId="panelSchema.id"
    />
    <CustomChartRenderer
      v-else-if="panelSchema.type == 'custom_chart'"
      :data="panelData"
    />
    <GeoMapRenderer
      v-else-if="panelSchema.type == 'geomap'"
      :data="panelData.chartType == 'geomap' ? panelData : { options: {} }"
    />
    <MapsRenderer
      v-else-if="panelSchema.type == 'maps'"
      :data="panelData.chartType == 'maps' ? panelData : { options: {} }"
    />
    <ChartRenderer
      v-else
      :data="chartRendererData"
      :render-type="panelSchema?.type === 'metric' ? 'svg' : 'canvas'"
    />

    <div
      v-if="errorMessage"
      class="absolute inset-x-2 bottom-1 text-2xs text-error-500"
    >
      {{ errorMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref, computed, watch, onMounted } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { convertPanelData } from "@/utils/dashboard/convertPanelData";
import CustomChartRenderer from "./panels/CustomChartRenderer.vue";

interface PanelSnapshot {
  state?: { state?: string; reason?: string };
  data?: any[];
  resultMetaData?: any[];
  metadata?: Record<string, unknown>;
  sparklineData?: any;
}

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);
const TableRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/TableRenderer.vue"),
);
const GeoMapRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/GeoMapRenderer.vue"),
);
const MapsRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/MapsRenderer.vue"),
);
const HTMLRenderer = defineAsyncComponent(
  () => import("./panels/HTMLRenderer.vue"),
);
const MarkdownRenderer = defineAsyncComponent(
  () => import("./panels/MarkdownRenderer.vue"),
);

// The panel schema is the codebase-wide untyped dashboard panel object, same as
// PanelSchemaRenderer consumes.
const props = defineProps<{
  panelSchema: Record<string, any>;
  snapshot: PanelSnapshot;
}>();

const store = useStore();
const { t } = useI18nTyped();

const chartPanelRef = ref<HTMLElement | null>(null);
const panelData = ref<any>({ options: {} });
const errorMessage = ref<I18nText | "">("");
const chartPanelStyle = ref({ height: "100%", width: "100%" });

const noData = computed(() => {
  const rows = props.snapshot?.data?.[0]?.hits ?? props.snapshot?.data?.[0];
  return Array.isArray(rows) && rows.length === 0;
});

const chartRendererData = computed(() =>
  noData.value ? { options: { backgroundColor: "transparent" } } : panelData.value,
);

const tableRendererData = computed(() => {
  if (props.panelSchema.type !== "table") {
    return { options: { backgroundColor: "transparent" } };
  }
  if (noData.value) return { rows: [], columns: [] };
  if (props.panelSchema.queryType === "promql") {
    return panelData.value?.options || { rows: [], columns: [] };
  }
  if (panelData.value?.chartType == "table") return panelData.value;
  return { options: { backgroundColor: "transparent" } };
});

// The same client-side conversion PanelSchemaRenderer runs, but on the pre-built
// snapshot instead of a live search — no query is ever fired here.
const build = async () => {
  errorMessage.value = "";
  if (props.panelSchema.type === "html" || props.panelSchema.type === "markdown") {
    return;
  }
  try {
    const resultMetaData = ref(props.snapshot?.resultMetaData ?? []);
    const annotations = ref([]);
    panelData.value = await convertPanelData(
      props.panelSchema,
      props.snapshot?.data ?? [],
      store,
      chartPanelRef,
      null,
      resultMetaData,
      props.snapshot?.metadata ?? {},
      chartPanelStyle.value,
      annotations,
      false,
      props.snapshot?.sparklineData,
    );
  } catch {
    errorMessage.value = t("dashboard.publicDashboard.renderError");
  }
};

onMounted(build);
watch(() => props.snapshot, build);
</script>
