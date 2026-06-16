<template>
  <div>
    <OSeparator />

    <!-- Options Row: Query Type Tabs + Legend + Step Value -->
    <div>
      <div class="tw:flex tw:flex-row tw:items-center tw:pl-2">
        <div class="tw:whitespace-nowrap tw:min-w-21.5 tw:text-sm tw:flex tw:items-center">{{ t("panel.options") }}</div>
        <span class="tw:flex tw:items-center tw:ml-0.5 tw:mr-0.5">:</span>
        <div class="tw:my-0.5 tw:mx-1.25 tw:flex tw:gap-2 tw:flex-wrap tw:items-center">
          <!-- Legend -->
          <div class="tw:flex tw:flex-row tw:items-center tw:gap-2 tw:ml-2.5">
            <span class="tw:text-[11px] tw:font-medium tw:whitespace-nowrap tw:opacity-85">{{ t("dashboard.legendLabel") }}</span>
            <div class="tw:relative tw:inline-block">
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
                class="tw:cursor-pointer tw:absolute tw:right-2 tw:top-1/2 tw:-translate-y-1/2 tw:z-10 tw:opacity-60 hover:tw:opacity-100 tw:pointer-events-auto"
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
          <div class="tw:flex tw:flex-row tw:items-center tw:gap-2 tw:ml-2.5">
            <span class="tw:text-[11px] tw:font-medium tw:whitespace-nowrap tw:opacity-85">{{ t("dashboard.stepValue") }}</span>
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
          <div class="tw:flex tw:flex-row tw:items-center tw:gap-2 tw:ml-2.5">
            <span class="tw:text-[11px] tw:font-medium tw:whitespace-nowrap tw:opacity-85">{{ t("common.type") }}</span>
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

