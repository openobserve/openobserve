<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="w-full" data-test="dashboard-raw-query-builder">
    <div class="flex flex-col" data-test="dashboard-raw-query-section">
      <OTextarea
        v-model="fields.rawQuery"
        :rows="10"
        :placeholder="t('dashboard.rawQueryBuilder.instruction')"
        data-test="dashboard-raw-query-textarea"
        class="w-full"
      />
    </div>
  </div>
</template>
<script lang="ts">
import { ref, watch } from "vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import { useI18nTyped } from "@/types/i18n";

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
    const { t } = useI18nTyped();
    const fields = ref(props.modelValue);

    watch(
      () => fields.value,
      (value: any) => {
        emit("update:modelValue", value);
      },
      { deep: true },
    );

    return {
      t,
      fields,
    };
  },
};
</script>
