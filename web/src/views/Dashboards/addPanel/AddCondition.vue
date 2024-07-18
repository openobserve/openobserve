<template>
  <div class="condition">
    <!-- <span>{{ label }}</span> -->
    <div>
      <!-- {{ condition }} -->
      <div>
        <q-select v-model="addLabel" dense filled :options="filterOptions" />
      </div>
      <q-btn
        square
        icon-right="arrow_drop_down"
        no-caps
        dense
        :no-wrap="true"
        color="primary"
        size="sm"
        :label="computedLabel(condition)"
        class="q-pl-sm"
      >
        <q-menu class="q-pa-md" @show="(e) => loadFilterItem(condition.column)">
          <q-select
            v-model="selectedSchemas"
            :options="schemaOptions"
            label="FieldList"
            dense
            filled
            style="width: 100%"
            use-input
            borderless
            hide-selected
            fill-input
            emit-value
            @filter="filterStreamFn"
          />
          <div style="height: 100%">
            <div class="q-pa-xs" style="height: 100%">
              <div class="q-gutter-xs" style="height: 100%">
                <q-tabs v-model="condition.type" dense>
                  <q-tab
                    dense
                    name="list"
                    :label="t('common.list')"
                    style="width: auto"
                  ></q-tab>
                  <q-tab
                    dense
                    name="condition"
                    :label="t('common.condition')"
                    style="width: auto"
                  ></q-tab>
                </q-tabs>
                <q-separator></q-separator>
                <q-tab-panels
                  v-model="condition.type"
                  dense
                  animated
                  style="height: 100%"
                >
                  <q-tab-panel dense name="condition" class="q-pa-none">
                    <div class="flex column" style="height: 220px">
                      <q-select
                        dense
                        filled
                        v-model="condition.operator"
                        :options="operators"
                        :label="t('common.operator')"
                        style="width: 100%"
                      />
                      <CommonAutoComplete
                        v-if="
                          !['Is Null', 'Is Not Null'].includes(
                            condition.operator
                          )
                        "
                        :label="t('common.value')"
                        v-model="condition.value"
                        :items="dashboardVariablesFilterItems"
                        searchRegex="(?:^|[^$])\$?(\w+)"
                      ></CommonAutoComplete>
                    </div>
                  </q-tab-panel>
                  <q-tab-panel dense name="list" class="q-pa-none">
                    <q-select
                      dense
                      filled
                      v-model="condition.values"
                      :options="
                        dashboardPanelData.meta.filterValue.find(
                          (it: any) => it.column == condition.column
                        )?.value
                      "
                      :label="t('common.selectFilter')"
                      multiple
                      emit-value
                      map-options
                    >
                      <template v-slot:selected>
                        {{
                          condition.values[0]?.length > 15
                            ? condition.values[0]?.substring(0, 15) + "..."
                            : condition.values[0]
                        }}
                        {{
                          condition.values?.length > 1
                            ? " +" + (condition.values?.length - 1)
                            : ""
                        }}
                      </template>
                      <template
                        v-slot:option="{
                          itemProps,
                          opt,
                          selected,
                          toggleOption,
                        }"
                      >
                        <q-item v-bind="itemProps">
                          <q-item-section side>
                            <q-checkbox
                              dense
                              :model-value="selected"
                              @update:model-value="toggleOption(opt)"
                            ></q-checkbox>
                          </q-item-section>
                          <q-item-section>
                            <SanitizedHtmlRenderer :html-content="opt" />
                          </q-item-section>
                        </q-item>
                      </template>
                    </q-select>
                  </q-tab-panel>
                </q-tab-panels>
              </div>
            </div>
          </div>
        </q-menu>
      </q-btn>
      <q-btn size="xs" dense @click="$emit('remove-condition')" icon="close" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import CommonAutoComplete from "@/components/dashboards/addPanel/CommonAutoComplete.vue";
import SanitizedHtmlRenderer from "@/components/SanitizedHtmlRenderer.vue";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "AddCondition",
  components: {
    CommonAutoComplete,
    SanitizedHtmlRenderer,
  },
  props: [
    "condition",
    "schemaOptions",
    "dashboardVariablesFilterItems",
    "label",
  ],
  setup(props) {
    const { dashboardPanelData, loadFilterItem } = useDashboardPanelData();
    const { t } = useI18n();

    const schemaOptions = computed(() =>
      dashboardPanelData.meta.stream.selectedStreamFields.map((field: any) => ({
        label: field.name,
        value: field.name,
      }))
    );

    const filterStreamFn = (search: any, update: any) => {
      const needle = search.toLowerCase().trim();

      update(() => {
        return schemaOptions.value.filter((option: any) =>
          option.label.toLowerCase().includes(needle)
        );
      });
    };
    const operators = [
      "=",
      "<>",
      ">=",
      "<=",
      ">",
      "<",
      "IN",
      "Contains",
      "Not Contains",
      "Is Null",
      "Is Not Null",
    ];

    const filterOptions = ["AND", "OR"];

    const showSelect = ref(false);
    const addLabel = ref("AND");
    const selectedSchemas = ref<any[]>([]);

    const computedLabel = (condition: any) => {
      return condition.operator && condition.value
        ? `${condition.column} ${condition.operator} ${condition.value}`
        : condition.column;
    };

    return {
      operators,
      filterOptions,
      showSelect,
      addLabel,
      selectedSchemas,
      computedLabel,
      t,
      loadFilterItem,
      filterStreamFn,
      dashboardPanelData,
    };
  },
});
</script>

<style scoped>
.condition {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
