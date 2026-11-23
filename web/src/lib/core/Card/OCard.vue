<script setup lang="ts">
import { computed } from "vue";

import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";

import type { OCardProps, OCardSlots } from "./OCard.types";

const props = withDefaults(defineProps<OCardProps>(), { flush: false, loading: false });
const slots = defineSlots<OCardSlots>();

const hasHeader = computed(() => !!props.title || !!slots.header);
</script>

<template>
  <div
    class="bg-surface-base border-border-default rounded-surface text-text-body flex min-w-0 flex-col overflow-hidden border"
    :aria-busy="loading || undefined"
  >
    <div
      v-if="hasHeader"
      class="border-border-subtle flex h-10 shrink-0 items-center gap-2 border-b ps-3 pe-1.5"
      data-test="o-card-header"
    >
      <slot name="header">
        <h3 class="text-text-heading text-compact min-w-0 truncate font-semibold">{{ title }}</h3>
        <span v-if="meta" class="text-text-muted shrink-0 text-xs whitespace-nowrap">{{
          meta
        }}</span>
      </slot>
      <div v-if="slots.actions" class="ms-auto flex shrink-0 items-center gap-1.5">
        <slot name="actions" />
      </div>
    </div>
    <div class="text-compact min-h-0 flex-1" :class="{ 'p-3': !flush }" data-test="o-card-body">
      <div
        v-if="loading"
        class="flex flex-col gap-2"
        :class="{ 'p-3': flush }"
        data-test="o-card-skeleton"
      >
        <OSkeleton class="w-2/5" />
        <OSkeleton />
        <OSkeleton class="w-4/5" />
      </div>
      <slot v-else />
    </div>
    <div
      v-if="slots.footer"
      class="border-border-subtle text-text-secondary flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2 text-xs"
      data-test="o-card-footer"
    >
      <slot name="footer" />
    </div>
  </div>
</template>
