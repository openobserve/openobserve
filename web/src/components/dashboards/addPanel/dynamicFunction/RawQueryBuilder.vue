<template>
  <div>
    <div class="q-mb-sm rawQuery">Query</div>
    <q-input
      outlined
      v-model="fields.rawQuery"
      filled
      autogrow
      class="showLabelOnTop"
      data-test="dynamic-function-popup-raw-query-input"
    />
    <q-input
      v-model="fields.alias"
      label="Alias"
      color="input-border"
      bg-color="input-bg"
      class="q-py-md showLabelOnTop"
      stack-label
      disable
      filled
      dense
      label-slot
      data-test="dynamic-function-popup-raw-query-alias-input"
    />
  </div>
</template>

<script lang="ts">
import { ref, watch } from "vue";
import { useStore } from "vuex";

//   import useDashboardPanelData from "@/composables/useDashboardPanel";

export default {
  name: "RawQueryBuilder",
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

    const store = useStore();

    const fields = ref(props.modelValue);

    watch(
      () => fields.value,
      (value: any) => {
        emit("update:modelValue", value);
      },
      {
        deep: true,
      },
    );

    return {
      store,
      fields,
    };
  },
};
</script>
<style scoped>
.rawQuery {
  margin-top: 5px;
  margin-bottom: 5px;
  font-size: 14px;
  font-weight: 600;
  color: #666666;
}
</style>
