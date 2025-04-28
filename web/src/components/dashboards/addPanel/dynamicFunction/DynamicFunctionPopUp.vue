<template>
  <div style="width: 500px">
    <q-tabs
      v-model="fields.type"
      @update:modelValue="onFieldTypeChange"
      dense
      class="text-grey"
      active-color="primary"
      indicator-color="primary"
      narrow-indicator
      data-test="dynamic-function-popup-tabs"
    >
      <q-tab name="build" label="Build" data-test="dynamic-function-popup-tab-build" />
      <q-tab name="raw" label="Raw" data-test="dynamic-function-popup-tab-raw" />
    </q-tabs>

    <q-separator />

    <q-tab-panels v-model="fields.type" animated>
      <q-tab-panel name="build">
        <SelectFunction v-model="fields" data-test="dynamic-function-popup-select-function" />
      </q-tab-panel>
      <q-tab-panel name="raw">
        <RawQueryBuilder v-model="fields" data-test="dynamic-function-popup-raw-query-builder" />
      </q-tab-panel>
    </q-tab-panels>
  </div>
</template>

<script lang="ts">
import { ref, watch } from "vue";
//   import useDashboardPanelData from "@/composables/useDashboardPanel";
import RawQueryBuilder from "./RawQueryBuilder.vue";
import SelectFunction from "./SelectFunction.vue";

export default {
  name: "DynamicFunctionPopUp",
  components: { RawQueryBuilder, SelectFunction },
  props: {
    modelValue: {
      type: Object,
      required: true,
    },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    //   const dashboardPanelDataPageKey = inject(
    //     "dashboardPanelDataPageKey",
    //     "dashboard",
    //   );
    //   const { dashboardPanelData } = useDashboardPanelData(
    //     dashboardPanelDataPageKey
    //   );

    const fields = ref(props.modelValue);

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
      fields,
      onFieldTypeChange,
    };
  },
};
</script>
<style scoped></style>
