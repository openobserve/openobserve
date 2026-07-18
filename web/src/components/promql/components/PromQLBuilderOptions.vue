<template>
  <div>
    <OSeparator />

    <!-- Options Row: Query Type Tabs + Legend + Step Value -->
    <div>
      <div class="flex flex-row items-center pl-2">
        <div
          data-test="promql-builder-options-label"
          class="whitespace-nowrap min-w-21.5 text-sm flex items-center"
        >{{ t("panel.options") }}</div>
        <span class="flex items-center ml-0.5 mr-0.5">:</span>
        <div
          data-test="promql-builder-options-axis-container"
          class="my-0.5 mx-1.25 flex gap-2 flex-wrap items-center"
        >
          <!-- Legend -->
          <div
            data-test="promql-builder-options-field-wrapper"
            class="flex flex-row items-center gap-2 ml-2.5"
          >
            <span
              data-test="promql-builder-options-field-label"
              class="text-[11px] font-medium whitespace-nowrap opacity-85"
            >{{ t("dashboard.legendLabel") }}</span>
            <div
              data-test="promql-builder-options-field-input-wrapper"
              class="relative inline-block"
            >
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
                data-test="promql-builder-options-field-info-icon"
                class="cursor-pointer absolute right-2 top-1/2 -translate-y-1/2 z-10 opacity-60 hover:opacity-100 pointer-events-auto"
              >
                <OTooltip side="top" max-width="250px">
                  <template #content>
                    ({{ t("dashboard.optional") }}) <b>{{ t('metrics.promQLBuilderOptions.legend') }}</b>
                    {{ t("dashboard.overrideMessage") }}
                    <br />
                    {{ t("dashboard.overrideMessageExample") }}
                  </template>
                </OTooltip>
              </OIcon>
            </div>
          </div>

          <!-- Step Value -->
          <div
            data-test="promql-builder-options-field-wrapper"
            class="flex flex-row items-center gap-2 ml-2.5"
          >
            <span
              data-test="promql-builder-options-field-label"
              class="text-[11px] font-medium whitespace-nowrap opacity-85"
            >{{ t("dashboard.stepValue") }}</span>
            <OInput
              v-model="
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].config.step_value
              "
              type="text"
              :placeholder="t('metrics.promQLBuilderOptions.stepValuePlaceholder')"
              data-test="dashboard-promql-builder-step-value"
              style="width: 140px"
            >
              <template v-slot:icon-right>
                <OIcon name="info" size="sm" class="cursor-pointer">
                  <OTooltip side="top" max-width="250px">
                    <template #content>
                      ({{ t("dashboard.optional") }}) <b>{{ t('metrics.promQLBuilderOptions.step') }}</b>
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
          <div
            data-test="promql-builder-options-field-wrapper"
            class="flex flex-row items-center gap-2 ml-2.5"
          >
            <span
              data-test="promql-builder-options-field-label"
              class="text-[11px] font-medium whitespace-nowrap opacity-85"
            >{{ t("common.type") }}</span>
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
            />
            <OIcon
              name="info"
              size="sm"
              data-test="promql-builder-options-field-info-icon"
              class="cursor-pointer"
            >
              <OTooltip side="top" max-width="250px">
                <template #content>
                  <b>{{ t('metrics.promQLBuilderOptions.queryType') }}</b><br />
                  {{ t('metrics.promQLBuilderOptions.rangeDescription') }}<br />
                  {{ t('metrics.promQLBuilderOptions.instantDescription') }}
                </template>
              </OTooltip>
            </OIcon>
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
        label: t("metrics.promQLBuilderOptions.range"),
        value: "range",
      },
      {
        label: t("metrics.promQLBuilderOptions.instant"),
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

