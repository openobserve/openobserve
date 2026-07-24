<template>
  <div>
    <OButton
      variant="outline"
      size="sm"
      @click="openOverrideConfigPopup"
      data-test="dashboard-addpanel-config-override-config-add-btn"
    >
      {{ t("dashboard.addFieldOverride") }}
    </OButton>

    <OverrideConfigPopup
      :open="showOverrideConfigPopup"
      :columns="columns"
      :override-config="{
        overrideConfigs: dashboardPanelData.data.config.override_config || [],
      }"
      :preview-data="previewData"
      :value-mapping="dashboardPanelData.data.config.mappings || []"
      :panel-unit="dashboardPanelData.data.config.unit ?? ''"
      :panel-unit-custom="dashboardPanelData.data.config.unit_custom ?? ''"
      :panel-decimals="dashboardPanelData.data.config.decimals ?? 2"
      @close="showOverrideConfigPopup = false"
      @save="saveOverrideConfigConfig"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, inject, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import OverrideConfigPopup from "../OverrideConfigPopup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";

interface Column {
  alias: string;
  label: string;
  format?: (val: unknown) => string;
}

export default defineComponent({
  name: "OverrideConfig",
  components: { OverrideConfigPopup, OButton },
  props: {
    panelData: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props) {
    const { t } = useI18n();
    const dashboardPanelDataPageKey = inject("dashboardPanelDataPageKey", "dashboard");
    const { dashboardPanelData, promqlMode, fetchPromQLLabels } =
      useDashboardPanelData(dashboardPanelDataPageKey);

    const showOverrideConfigPopup = ref(false);
    const columns: any = ref<Column[]>([]);

    // Per-alias sample rows + column defs for the dialog's live preview.
    const previewData = computed(() => {
      const cols = (props.panelData?.columns as any[]) || [];
      const rows = (props.panelData?.rows as any[]) || [];
      const map: Record<string, { column: any; rows: any[] }> = {};
      for (const c of cols) {
        const alias = String(c.alias ?? c.field ?? c.name ?? "").toLowerCase();
        if (!alias) continue;
        const key = c.field ?? c.alias ?? c.name;
        const sample: any[] = [];
        for (const row of rows) {
          const v = row?.[key];
          if (v !== null && v !== undefined && v !== "") sample.push(row);
          if (sample.length >= 6) break;
        }
        map[alias] = { column: c, rows: sample };
      }
      return map;
    });

    const fetchColumns = () => {
      // Different logic for PromQL vs SQL queries
      if (promqlMode.value) {
        // PromQL mode: Get actual columns from the rendered table data
        // This ensures we get exactly what's shown in the table
        const columnNames = new Set<string>();

        // Numeric detection is name-based, not alignment (alignment is user-overridable).
        if (props.panelData?.options?.columns) {
          props.panelData.options.columns.forEach((col: any) => {
            if (col.name) columnNames.add(col.name);
          });
        } else {
          // Fallback: Build columns based on table mode and available labels
          const config = dashboardPanelData.data.config || {};
          const tableMode = config.promql_table_mode || "single";

          if (tableMode === "single") {
            // In "single" (Timestamp) mode: timestamp + value columns
            columnNames.add("timestamp");
            columnNames.add("value");
          } else if (tableMode === "expanded_timeseries" || tableMode === "all") {
            if (tableMode === "expanded_timeseries") {
              columnNames.add("timestamp");
            }

            // Collect label keys from available labels (from PromQL label discovery)
            if (dashboardPanelData.meta?.promql?.availableLabels) {
              dashboardPanelData.meta.promql.availableLabels.forEach((label: string) => {
                columnNames.add(label);
              });
            }

            // Add value column(s)
            const aggregations = config.table_aggregations || [config.aggregation || "last"];
            if (aggregations.length === 1) {
              columnNames.add("value");
            } else {
              aggregations.forEach((agg: string) => {
                columnNames.add(`value_${agg}`);
              });
            }
          }
        }

        // Convert Set to Array and sort
        let columnArray = Array.from(columnNames).sort();

        // Convert to column format expected by OverrideConfigPopup
        columns.value = columnArray.map((columnName) => ({
          alias: columnName,
          label: columnName,
          // panelData path uses align; fallback uses name heuristic
          isNumeric: columnName === "value" || columnName.startsWith("value_"),
        }));
      } else {
        const seen = new Set<string>();
        const collected: any[] = [];
        const addField = (col: any, isNumeric: boolean) => {
          const key = String(col?.alias ?? "").toLowerCase();
          if (!key || seen.has(key)) return;
          seen.add(key);
          collected.push({ ...col, isNumeric });
        };
        const queries = dashboardPanelData.data.queries || [];
        queries.forEach((q: any) => (q?.fields?.x || []).forEach((c: any) => addField(c, false)));
        queries.forEach((q: any) =>
          (q?.fields?.breakdown || []).forEach((c: any) => addField(c, false)),
        );
        queries.forEach((q: any) => (q?.fields?.y || []).forEach((c: any) => addField(c, true)));
        columns.value = collected;
      }
    };

    const openOverrideConfigPopup = async () => {
      // For PromQL mode, fetch labels first to ensure we have the latest label data
      if (promqlMode.value) {
        const query = dashboardPanelData.data.queries[0];
        const metric = query?.fields?.stream;
        if (metric) {
          await fetchPromQLLabels(metric);
        }
      }

      fetchColumns();
      showOverrideConfigPopup.value = true;
    };

    const saveOverrideConfigConfig = (overrideConfig: any) => {
      dashboardPanelData.data.config.override_config = overrideConfig;
      showOverrideConfigPopup.value = false;
    };

    fetchColumns();

    onBeforeMount(() => {
      // Ensure that the override_config object is initialized in config
      if (!dashboardPanelData.data.config.override_config) {
        dashboardPanelData.data.config.override_config = [];
      }
    });

    return {
      t,
      dashboardPanelData,
      showOverrideConfigPopup,
      openOverrideConfigPopup,
      saveOverrideConfigConfig,
      columns,
      previewData,
    };
  },
});
</script>
