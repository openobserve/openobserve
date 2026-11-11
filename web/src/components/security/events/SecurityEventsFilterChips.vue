<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { FieldFilter } from "@/utils/security/eventQuery";

defineProps<{ filters: FieldFilter[] }>();
const emit = defineEmits<{ invert: [index: number]; remove: [index: number]; clear: [] }>();
const { t } = useI18nTyped();

const OP_SYMBOL: Record<string, string> = {
  "=": "=",
  "!=": "≠",
  contains: "~",
  not_contains: "!~",
};
</script>

<template>
  <div v-if="filters.length" class="flex flex-wrap items-center gap-1.5">
    <OTag
      v-for="(f, i) in filters"
      :key="`${f.field}-${f.op}-${f.value}`"
      :variant="f.op === '!=' || f.op === 'not_contains' ? 'error-soft' : 'primary-soft'"
      shape="rounded"
      size="sm"
      :data-test="`security-events-filter-${i}`"
    >
      <span class="max-w-80 truncate font-mono">
        <span class="font-semibold">{{ f.field }}</span>
        {{ OP_SYMBOL[f.op] ?? f.op }} {{ f.value }}
      </span>
      <template #trailing>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="swap-horiz"
          :data-test="`security-events-filter-invert-${i}`"
          @click="emit('invert', i)"
        >
          <OTooltip :content="t('siem.events.invertFilter')" />
        </OButton>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="close"
          :data-test="`security-events-filter-remove-${i}`"
          @click="emit('remove', i)"
        >
          <OTooltip :content="t('siem.events.removeFilter')" />
        </OButton>
      </template>
    </OTag>
    <OButton
      variant="ghost-muted"
      size="xs"
      data-test="security-events-clear-filters"
      @click="emit('clear')"
    >
      {{ t("siem.events.clearFilters") }}
    </OButton>
  </div>
</template>
