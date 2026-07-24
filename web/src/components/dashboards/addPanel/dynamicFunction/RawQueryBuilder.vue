<template>
  <div class="w-full" data-test="dashboard-raw-query-builder">
    <div class="query-section" data-test="dashboard-raw-query-section">
      <div class="query-label" data-test="dashboard-raw-query-title">{{ t('common.query') }}</div>
      <div class="query-label text-xs" data-test="dashboard-raw-query-instruction">
        {{ t('dashboard.rawQueryBuilder.instruction') }}
      </div>

      <OTextarea
        v-model="fields.rawQuery"
        :rows="6"
        data-test="dashboard-raw-query-textarea"
        class="mt-0.5"
      />
    </div>
  </div>
</template>
<script lang="ts">
import { ref, watch } from "vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import { useI18n } from "vue-i18n";

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
