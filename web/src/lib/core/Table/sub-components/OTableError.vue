<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import { raw, useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();

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
  <div data-test="o2-table-error" class="sticky start-0 px-2 py-4">
    <slot :message="message ?? ''">
      <OInlineNotice tone="err" :message="raw(message ?? '')">
        <template v-if="message" #actions>
          <button
            data-test="o2-table-error-retry-btn"
            class="rounded-default bg-white/20 px-3 py-1 text-sm transition-colors hover:bg-white/30"
            @click="$emit('retry')"
          >
            {{ t("common.retry") }}
          </button>
        </template>
      </OInlineNotice>
    </slot>
  </div>
</template>
