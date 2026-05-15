<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  message?: string | null;
}>();

defineEmits<{
  retry: [];
}>();

defineSlots<{
  default(props: { message: string }): any;
}>();
</script>

<template>
  <div
    data-test="o2-table-error"
    class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:py-8 tw:text-center tw:gap-2"
  >
    <slot :message="message ?? ''">
      <q-icon
        name="warning"
        size="1.25rem"
        class="tw:text-warning-500"
      />
      <div class="tw:text-text-secondary tw:text-sm">
        {{ message ?? t("errors.defaultError") }}
      </div>
    </slot>
  </div>
</template>
