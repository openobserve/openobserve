<template>
  <div style="width: 100%" data-test="dashboard-raw-query-builder">
    <div class="query-section" data-test="dashboard-raw-query-section">
      <div class="query-label" data-test="dashboard-raw-query-title">Query</div>
      <div class="query-label tw:text-xs" data-test="dashboard-raw-query-instruction">
        Write a SQL query for complex actions.
      </div>

      <OTextarea
        v-model="fields.rawQuery"
        :rows="6"
        data-test="dashboard-raw-query-textarea"
        class="tw:mt-0.5"
      />
    </div>
  </div>
</template>
<script lang="ts">
import { ref, watch } from "vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";

export default {
  name: "RawQueryBuilder",
  components: { OTextarea },
  props: {
    modelValue: {
      type: Object,
      required: true,
    },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const fields = ref(props.modelValue);

    watch(
      () => fields.value,
      (value: any) => {
        emit("update:modelValue", value);
      },
      { deep: true },
    );

    return {
      fields,
    };
  },
};
</script>