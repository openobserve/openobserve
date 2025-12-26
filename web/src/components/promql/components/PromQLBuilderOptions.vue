<template>
  <div>
    <q-separator />

    <!-- Options Row: Query Type Tabs + Legend + Step Value -->
    <div class="tw-py-[0.25rem]">
      <div style="display: flex; flex-direction: row" class="q-pl-md">
        <div class="layout-name">{{ t("panel.options") }}</div>
        <span class="layout-separator">:</span>
        <div class="axis-container">
          <!-- Legend -->
          <div class="option-field-wrapper">
            <span class="field-label">{{ t("dashboard.legendLabel") }}</span>
            <div class="field-input-wrapper">
              <CommonAutoComplete
                v-model="
                  dashboardPanelData.data.queries[
                    dashboardPanelData.layout.currentQueryIndex
                  ].config.promql_legend
                "
                :items="dashboardSelectfieldPromQlList"
                searchRegex="(?:{([^}]*)(?:{.*})*$|([a-zA-Z-_]+)$)"
                color="input-border"
                bg-color="input-bg"
                class="showLabelOnTop"
                stack-label
                borderless
                data-test="dashboard-promql-builder-legend"
                :value-replace-fn="selectPromQlNameOption"
                style="width: 260px"
              />
              <q-icon
                name="info"
                size="16px"
                class="cursor-pointer field-info-icon"
              >
                <q-tooltip
                  class="bg-grey-8"
                  anchor="top middle"
                  self="bottom middle"
                  max-width="250px"
                >
                  ({{ t("dashboard.optional") }}) <b>Legend - </b>
                  {{ t("dashboard.overrideMessage") }}
                  <br />
                  {{ t("dashboard.overrideMessageExample") }}
                </q-tooltip>
              </q-icon>
            </div>
          </div>

          <!-- Step Value -->
          <div class="option-field-wrapper">
            <span class="field-label">{{ t("dashboard.stepValue") }}</span>
            <q-input
              v-model="
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].config.step_value
              "
              type="text"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              borderless
              dense
              placeholder="e.g., 30s, 1m"
              data-test="dashboard-promql-builder-step-value"
              hide-bottom-space
              style="width: 140px"
            >
              <template v-slot:append>
                <q-icon
                  name="info"
                  size="16px"
                  class="cursor-pointer"
                >
                  <q-tooltip
                    class="bg-grey-8"
                    anchor="top middle"
                    self="bottom middle"
                    max-width="250px"
                  >
                    ({{ t("dashboard.optional") }}) <b>Step - </b>
                    {{ t("dashboard.stepValueTooltip") }}
                    <br />
                    {{ t("dashboard.stepValueTooltipInfo") }}
                    <br />
                    {{ t("dashboard.stepValueExample") }}
                  </q-tooltip>
                </q-icon>
              </template>
            </q-input>
          </div>

                    <!-- Query Type Tabs (Range/Instant) -->
          <div class="option-field-wrapper">
            <span class="field-label">{{ t("common.type") }}</span>
            <AppTabs
              :tabs="queryTypeTabs"
              :active-tab="
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].config.query_type
              "
              class="tabs-selection-container"
              @update:active-tab="updateQueryType"
              data-test="dashboard-promql-builder-query-type"
            />
            <q-icon name="info" size="16px" class="cursor-pointer !tw-text-[var(--o2-icon-color-dark)]">
              <q-tooltip
                class="bg-grey-8"
                anchor="top middle"
                self="bottom middle"
                max-width="250px"
              >
                <b>Query Type - </b><br />
                Range: Returns time series data over a time range.<br />
                Instant: Returns single value at a specific point in time.
              </q-tooltip>
            </q-icon>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useI18n } from "vue-i18n";
import CommonAutoComplete from "@/components/dashboards/addPanel/CommonAutoComplete.vue";
import AppTabs from "@/components/common/AppTabs.vue";

export default defineComponent({
  name: "PromQLBuilderOptions",
  components: {
    CommonAutoComplete,
    AppTabs,
  },
  props: {
    dashboardPanelData: {
      type: Object,
      required: true,
    },
  },
  setup(props) {
    const { t } = useI18n();

    // Initialize query_type if not set (default to "range")
    const currentQuery =
      props.dashboardPanelData.data.queries[
        props.dashboardPanelData.layout.currentQueryIndex
      ];
    if (!currentQuery.config.query_type) {
      currentQuery.config.query_type = "range";
    }

    // Query type tabs for AppTabs
    const queryTypeTabs = [
      {
        label: "Range",
        value: "range",
      },
      {
        label: "Instant",
        value: "instant",
      },
    ];

    // Computed property for PromQL legend field suggestions
    const dashboardSelectfieldPromQlList = computed(() => {
      // Get fields from groupedFields based on current query's stream
      const currentQuery =
        props.dashboardPanelData.data.queries[
          props.dashboardPanelData.layout.currentQueryIndex
        ];
      const currentStream = currentQuery?.fields?.stream;

      if (!currentStream) return [];

      // Find the current stream in groupedFields
      const streamFields =
        props.dashboardPanelData.meta.streamFields.groupedFields.find(
          (group: any) => group.name === currentStream,
        );

      if (!streamFields?.schema) return [];

      return streamFields.schema.map((it: any) => {
        return {
          label: it.name,
          value: it.name,
        };
      });
    });

    // Method to replace PromQL legend value with selected option
    const selectPromQlNameOption = (option: any) => {
      const inputValue =
        props.dashboardPanelData.data.queries[
          props.dashboardPanelData.layout.currentQueryIndex
        ].config.promql_legend;

      // Find the index of the last opening brace '{'
      const openingBraceIndex = inputValue.lastIndexOf("{");

      //if { is not present add it at the start and than return

      if (openingBraceIndex === -1) {
        const newValue =
          "{" + inputValue.slice(0, openingBraceIndex + 1) + option + "}";
        return newValue;
      } else {
        const newValue =
          inputValue.slice(0, openingBraceIndex + 1) + option + "}";
        return newValue;
      }
    };

    // Method to update query type when tab changes
    const updateQueryType = (value: string) => {
      props.dashboardPanelData.data.queries[
        props.dashboardPanelData.layout.currentQueryIndex
      ].config.query_type = value;
    };

    return {
      t,
      queryTypeTabs,
      dashboardSelectfieldPromQlList,
      selectPromQlNameOption,
      updateQueryType,
    };
  },
});
</script>

<style lang="scss" scoped>
.option-field-wrapper {
  :deep(.o2-tabs) {
    border: 1px solid var(--o2-border-color) !important;
    border-radius: 4px;
    overflow: hidden !important;

    .o2-tab {
      border-radius: 0px !important;
      padding: 4px 8px !important;
      min-width: 66px !important;
    }

    .active {
      background-color: transparent !important;
      border-bottom: 2px solid var(--o2-theme-color) !important;
      color: var(--o2-theme-color) !important;
    }
  }
}
.layout-name {
  white-space: nowrap;
  min-width: 80px;
  font-size: 12px;
  line-height: 24px;
  font-weight: 600;
  display: flex;
  align-items: center;
}

.layout-separator {
  display: flex;
  align-items: center;
  margin-left: 2px;
  margin-right: 2px;
}

.axis-container {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.option-field-wrapper {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.field-label {
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  opacity: 0.85;
}

.field-input-wrapper {
  position: relative;
  display: inline-block;
}

.field-info-icon {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  pointer-events: auto;
  color: inherit;
  opacity: 0.6;
}

.field-info-icon:hover {
  opacity: 1;
}
</style>
