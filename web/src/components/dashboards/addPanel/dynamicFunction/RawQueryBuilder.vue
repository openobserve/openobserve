<template>
  <div style="width: 100%">
    <div class="query-section">
      <div class="query-label">Query</div>

      <textarea
        style="
          min-width: 100%;
          max-width: 100%;
          resize: vertical;
          border: 1px solid;
          border-radius: 4px;
          padding: 2px;
        "
        v-model="fields.rawQuery"
        :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
        data-test="dashboard-drilldown-url-textarea"
      ></textarea>
    </div>
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
.query-section {
  margin-bottom: 20px;
}

.query-label {
  font-size: 14px;
  font-weight: 600;
  color: #666666;
  margin-bottom: 5px;
}

.query-input {
  width: 100%;
  min-height: 100px;
  padding: 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  resize: vertical;
}
</style>
