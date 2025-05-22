<template>
  <div class="tw-flex tw-gap-2">
    <div style="width: 134px; padding-right: 12px; padding-top: 12px">
      <div class="text-label-bold tw-pb-3">Property</div>
      <div style="display: flex; flex-direction: column; gap: 14px">
        <div>
          <div class="text-label-normal tw-text-sm">Label</div>
          <input
            v-model="fields.label"
            :class="[
              store.state.theme === 'dark' ? 'bg-grey-10' : '',
              'edit-input',
            ]"
          />
        </div>
        <div>
          <div class="text-label-normal tw-text-sm">Alias</div>
          <input
            v-model="fields.alias"
            disabled
            :class="[
              store.state.theme === 'dark' ? 'bg-grey-10' : '',
              'edit-input',
            ]"
          />
        </div>
        <div v-if="!customQuery && !fields.isDerived">
          <SortByBtnGrp :fieldObj="fields" />
        </div>
      </div>
    </div>

    <div style="width: calc(100% - 134px)">
      <!-- active-color="primary" -->
      <!-- narrow-indicator -->
      <!-- class="text-grey" -->
      <!-- indicator-color="primary" -->
      <q-tabs
        v-model="fields.type"
        @update:modelValue="onFieldTypeChange"
        dense
        data-test="dynamic-function-popup-tabs"
        :align="'left'"
      >
        <q-tab
          name="build"
          label="Build"
          data-test="dynamic-function-popup-tab-build"
          class="tab-item-bold"
        />
        <q-tab
          name="raw"
          label="Raw"
          data-test="dynamic-function-popup-tab-raw"
          class="tab-item-bold"
        />
      </q-tabs>

      <q-separator />

      <q-tab-panels v-model="fields.type" animated>
        <q-tab-panel name="build" style="padding: 0px; padding-top: 8px">
          <div style="display: flex">
            <div style="width: calc(100% - 134px)">
              <div class="text-label-bold tw-pb-3">Configuration</div>
              <SelectFunction
                v-model="fields"
                data-test="dynamic-function-popup-select-function"
                :allowAggregation="allowAggregation"
              />
            </div>
          </div>
        </q-tab-panel>
        <q-tab-panel name="raw" style="padding: 0px; padding-top: 8px">
          <div style="display: flex; width: 100%">
            <div style="width: calc(100% - 134px)">
              <RawQueryBuilder
                v-model="fields"
                data-test="dynamic-function-popup-raw-query-builder"
              />
            </div>
          </div>
        </q-tab-panel>
      </q-tab-panels>
    </div>
  </div>
</template>

<script lang="ts">
import { ref, watch } from "vue";
import RawQueryBuilder from "./RawQueryBuilder.vue";
import SelectFunction from "./SelectFunction.vue";
import SortByBtnGrp from "@/components/dashboards/addPanel/SortByBtnGrp.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
export default {
  name: "DynamicFunctionPopUp",
  components: { RawQueryBuilder, SelectFunction, SortByBtnGrp },
  props: {
    modelValue: {
      type: Object,
      required: true,
    },
    allowAggregation: {
      type: Boolean,
      required: false,
      default: false,
    },
    customQuery: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const { t } = useI18n();
    //   const dashboardPanelDataPageKey = inject(
    //     "dashboardPanelDataPageKey",
    //     "dashboard",
    //   );
    //   const { dashboardPanelData } = useDashboardPanelData(
    //     dashboardPanelDataPageKey
    //   );

    const fields = ref(props.modelValue);

    const store = useStore();

    watch(
      () => fields.value,
      (value) => {
        emit("update:modelValue", value);
      },
      { deep: true },
    );

    const onFieldTypeChange = () => {
      // reset fields object
      if (fields.value.type === "build") {
        fields.value.rawQuery = "";
      } else {
        fields.value.functionName = null;
        fields.value.args = [
          {
            type: "field",
            value: {},
          },
        ];
      }
    };

    return {
      store,
      t,
      fields,
      onFieldTypeChange,
    };
  },
};
</script>
<style scoped>
.tab-item {
  flex: 0 1 auto !important;
  padding: 10px 16px !important;
}

.text-label-bold {
  font-family: "Nunito Sans";
  font-size: 13px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
}

.text-label-normal {
  font-family: "Nunito Sans";
  font-size: 13px;
  font-style: normal;
  font-weight: 400;
  line-height: normal;
}

.edit-input {
  flex: 1;
  border: 1px solid var(--q-primary);
  border-radius: 4px;
  padding: 2px;
  outline: none;
  min-width: 0;
  width: 100%;

  &:focus {
    border-color: var(--q-secondary);
  }
}
</style>
