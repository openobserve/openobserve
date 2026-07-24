<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
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
  <div data-test="o2-table-error" class="px-2 py-4">
    <slot :message="message ?? ''">
      <OBanner variant="error" :content="message ?? ''" inline-actions>
        <template v-if="message" #actions>
          <button
            data-test="o2-table-error-retry-btn"
            class="rounded-default bg-white/20 px-3 py-1 text-sm transition-colors hover:bg-white/30"
            @click="$emit('retry')"
          >
            {{ t('common.retry') }}
          </button>
        </template>
      </OBanner>
    </slot>
  </div>
</template>
