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

    <q-dialog v-model="showOverrideConfigPopup">
      <OverrideConfigPopup
        :columns="columns"
        :override-config="{
          overrideConfigs: dashboardPanelData.data.config.override_config || [],
        }"
        @close="showOverrideConfigPopup = false"
        @save="saveOverrideConfigConfig"
        :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
      />
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, inject, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OverrideConfigPopup from "../OverrideConfigPopup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";

interface Column {
  alias: string;
  label: string;
  format?: (val: unknown) => string;
}

export interface OverrideConfig {
  [key: string]: string;
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
    const store = useStore();
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData, promqlMode, fetchPromQLLabels } =
      useDashboardPanelData(dashboardPanelDataPageKey);

    const showOverrideConfigPopup = ref(false);
    const columns: any = ref<Column[]>([]);
    const overrideConfigs = ref<OverrideConfig[]>([]);

    const fetchColumns = () => {
      // Different logic for PromQL vs SQL queries
      if (promqlMode.value) {
        // PromQL mode: Get actual columns from the rendered table data
        // This ensures we get exactly what's shown in the table
        const columnNames = new Set<string>();

        // Try to get columns from the actual rendered panelData first
        if (props.panelData?.options?.columns) {
          props.panelData.options.columns.forEach((col: any) => {
            if (col.name) {
              columnNames.add(col.name);
            }
          });
        } else {
          // Fallback: Build columns based on table mode and available labels
          const config = dashboardPanelData.data.config || {};
          const tableMode = config.promql_table_mode || "single";

          if (tableMode === "single") {
            // In "single" (Timestamp) mode: timestamp + value columns
            columnNames.add("timestamp");
            columnNames.add("value");
          } else if (
            tableMode === "expanded_timeseries" ||
            tableMode === "all"
          ) {
            if (tableMode === "expanded_timeseries") {
              columnNames.add("timestamp");
            }

            // Collect label keys from available labels (from PromQL label discovery)
            if (dashboardPanelData.meta?.promql?.availableLabels) {
              dashboardPanelData.meta.promql.availableLabels.forEach(
                (label: string) => {
                  columnNames.add(label);
                },
              );
            }

            // Add value column(s)
            const aggregations = config.table_aggregations || [
              config.aggregation || "last",
            ];
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
        }));
      } else {
        const x = dashboardPanelData.data.queries[0].fields.x || [];
        const y = dashboardPanelData.data.queries[0].fields.y || [];
        columns.value = [...x, ...y];
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
      applyOverrideConfigs();
      showOverrideConfigPopup.value = false;
    };

    const applyOverrideConfigs = () => {
      const overrides = dashboardPanelData.data.config.override_config || [];

      columns.value = columns.value.map((col: any) => {
        return {
          name: col.alias,
          label: col.label,
          field: col.alias,
          format: (val: any) => {
            const unit = overrides[col.alias] || "";
            return `${val} ${unit}`;
          },
        };
      });
    };

    fetchColumns();
    applyOverrideConfigs();

    onBeforeMount(() => {
      // Ensure that the override_config object is initialized in config
      if (!dashboardPanelData.data.config.override_config) {
        dashboardPanelData.data.config.override_config = [];
      }
    });

    return {
      t,
      store,
      dashboardPanelData,
      showOverrideConfigPopup,
      openOverrideConfigPopup,
      saveOverrideConfigConfig,
      columns,
      overrideConfigs,
    };
  },
});
</script>
