<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import OBanner from "@/lib/feedback/Banner/OBanner.vue";

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
  <div data-test="o2-table-error" class="py-4 px-2">
    <slot :message="message ?? ''">
      <OBanner
        variant="error"
        :content="message ?? ''"
        inline-actions
      >
        <template v-if="message" #actions>
          <button
            data-test="o2-table-error-retry-btn"
            class="px-3 py-1 text-sm rounded bg-white/20 hover:bg-white/30 transition-colors"
            @click="$emit('retry')"
          >
            Retry
          </button>
        </template>
      </OBanner>
    </slot>
  </div>
</template>
