<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { isRawHttpText } from "@/lib/core/EmptyState/emptyStateCopy";
import { raw, useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();

const props = withDefaults(
  defineProps<{
    message?: string | null;
    /** Same floor as the empty state, so a failed load keeps the table's height. */
    floor?: boolean;
  }>(),
  { floor: true },
);

defineEmits<{
  retry: [];
}>();

defineSlots<{
  default(props: { message: string }): any;
}>();

// Raw transport text ("Request failed with status code 500") is never shown (K6).
const text = computed(() =>
  props.message && !isRawHttpText(props.message) ? raw(props.message) : undefined,
);
</script>

<template>
  <div
    data-test="o2-table-error"
    :class="['sticky start-0 flex flex-1 flex-col items-center', floor ? 'min-h-75' : '']"
  >
    <slot :message="message ?? ''">
      <OEmptyState
        kind="error"
        :title="t('emptyState.loadError.title')"
        :text="text ?? t('emptyState.loadError.description')"
      >
        <template #actions>
          <OButton data-test="o2-table-error-retry-btn" @click="$emit('retry')">
            {{ t("common.retry") }}
          </OButton>
        </template>
      </OEmptyState>
    </slot>
  </div>
</template>
