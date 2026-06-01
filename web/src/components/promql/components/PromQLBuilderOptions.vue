<template>
  <div>
    <OSeparator />

    <!-- Options Row: Query Type Tabs + Legend + Step Value -->
    <div>
      <div style="display: flex; flex-direction: row; align-items: center" class="tw:pl-2">
        <div class="layout-name">{{ t("panel.options") }}</div>
        <span class="layout-separator">:</span>
        <div class="axis-container">
          <!-- Legend -->
          <div class="option-field-wrapper">
            <span class="field-label">{{ t("dashboard.legendLabel") }}</span>
            <div class="field-input-wrapper">
              <OCombobox
                v-model="
                  dashboardPanelData.data.queries[
                    dashboardPanelData.layout.currentQueryIndex
                  ].config.promql_legend
                "
                :items="dashboardSelectfieldPromQlList"
                search-regex="(?:{([^}]*)(?:{.*})*$|([a-zA-Z-_]+)$)"
                data-test="dashboard-promql-builder-legend"
                :value-replace-fn="selectPromQlNameOption"
                style="width: 260px"
              />
              <OIcon
                name="info"
                size="sm"
                class="tw:cursor-pointer field-info-icon"
              >
                <OTooltip side="top" max-width="250px">
                  <template #content>
                    ({{ t("dashboard.optional") }}) <b>Legend - </b>
                    {{ t("dashboard.overrideMessage") }}
                    <br />
                    {{ t("dashboard.overrideMessageExample") }}
                  </template>
                </OTooltip>
              </OIcon>
            </div>
          </div>

          <!-- Step Value -->
          <div class="option-field-wrapper">
            <span class="field-label">{{ t("dashboard.stepValue") }}</span>
            <OInput
              v-model="
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].config.step_value
              "
              type="text"
              placeholder="e.g., 30s, 1m"
              data-test="dashboard-promql-builder-step-value"
              style="width: 140px"
            >
              <template v-slot:icon-right>
                <OIcon name="info" size="sm" class="tw:cursor-pointer">
                  <OTooltip side="top" max-width="250px">
                    <template #content>
                      ({{ t("dashboard.optional") }}) <b>Step - </b>
                      {{ t("dashboard.stepValueTooltip") }}
                      <br />
                      {{ t("dashboard.stepValueTooltipInfo") }}
                      <br />
                      {{ t("dashboard.stepValueExample") }}
                    </template>
                  </OTooltip>
                </OIcon>
              </template>
            </OInput>
          </div>

          <!-- Query Type Select (Range/Instant) -->
          <div class="option-field-wrapper">
            <span class="field-label">{{ t("common.type") }}</span>
            <OSelect
              v-model="
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].config.query_type
              "
              :options="queryTypeOptions"
              labelKey="label"
              valueKey="value"
              data-test="dashboard-promql-builder-query-type"
              style="width: 120px"
            >
              <template v-slot:append>
                <OIcon name="info" size="sm" class="tw:cursor-pointer">
                  <OTooltip side="top" max-width="250px">
                    <template #content>
                      <b>Query Type - </b><br />
                      Range: Returns time series data over a time range.<br />
                      Instant: Returns single value at a specific point in time.
                    </template>
                  </OTooltip>
                </OIcon>
              </template>
            </OSelect>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useI18n } from "vue-i18n";
import OCombobox from "@/lib/forms/Combobox/OCombobox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

export default defineComponent({
  name: "PromQLBuilderOptions",
  components: {
    OCombobox,
    OIcon,
    OInput,
    OSelect,
    OTooltip,
    OSeparator,
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

    // Query type options for q-select
    const queryTypeOptions = [
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

      const fieldName = (option as any)?.value ?? option;
      if (openingBraceIndex === -1) {
        const newValue =
          "{" + inputValue.slice(0, openingBraceIndex + 1) + fieldName + "}";
        return newValue;
      } else {
        const newValue =
          inputValue.slice(0, openingBraceIndex + 1) + fieldName + "}";
        return newValue;
      }
    };

    return {
      t,
      queryTypeOptions,
      dashboardSelectfieldPromQlList,
      selectPromQlNameOption,
    };
  },
});
</script>

<style lang="scss" scoped>
.layout-name {
  white-space: nowrap;
  min-width: 86px;
  font-size: 14px;
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
  margin: 2px 5px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.option-field-wrapper {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-left: 10px;
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
