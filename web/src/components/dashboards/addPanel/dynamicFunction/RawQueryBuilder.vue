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
import { useI18n } from "vue-i18n";
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
    const { t } = useI18n();
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
