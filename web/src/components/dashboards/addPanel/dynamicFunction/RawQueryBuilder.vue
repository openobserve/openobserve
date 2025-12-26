<template>
  <div style="width: 100%">
    <div class="query-section">
      <div class="query-label">Query</div>
      <div class="query-label tw:text-xs">
        Write a SQL query for complex actions.
      </div>

      <textarea
        style="
          min-width: 100%;
          max-width: 100%;
          resize: vertical;
          border: 1px solid #ccc;
          border-radius: 4px;
          margin-top: 2px;
          padding: 2px;
        "
        v-model="fields.rawQuery"
        :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
        data-test="dashboard-raw-query-textarea"
        :rows="6"
      ></textarea>
    </div>
  </div>
</template>
<script lang="ts">
import { ref, watch } from "vue";
import { useStore } from "vuex";

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
    const store = useStore();

    const fields = ref(props.modelValue);

    watch(
      () => fields.value,
      (value: any) => {
        emit("update:modelValue", value);
      },
      { deep: true },
    );

    return {
      store,
      fields,
    };
  },
};
</script>