<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- One result row of the Logs and Metrics explorers: the left chevron shows the record's JSON inline;
     the row and the right › open its detail. -->
<script setup lang="ts">
import { ref } from "vue";
import type { I18nText } from "@/types/i18n";
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";

defineProps<{
  record: Record<string, any>;
  /** The record's time, already formatted. */
  time: string;
  expanded: boolean;
  openLabel: I18nText;
  openDataTest: string;
}>();

const emit = defineEmits<{ toggle: []; open: [] }>();

const { t } = useI18nTyped();
const rowRef = ref<HTMLElement | null>(null);

// A click that ends a text selection made in the row keeps the selection rather than leaving the list.
const endsSelectionInRow = (): boolean => {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return false;
  const row = rowRef.value;
  return (
    !!row &&
    [selection.anchorNode, selection.focusNode].some((node) => !!node && row.contains(node))
  );
};
const openFromRow = () => {
  if (!endsSelectionInRow()) emit("open");
};
</script>

<template>
  <div
    ref="rowRef"
    class="dld-result-row border-border-default hover:bg-surface-subtle flex cursor-pointer items-center gap-2 border-b px-2 py-1"
    tabindex="0"
    @click="openFromRow"
    @keydown.enter.self.prevent="emit('open')"
  >
    <!-- Same look as DashboardLogDrawer's scoped .dld-expand-btn rule, which cannot reach this component. -->
    <button
      class="dld-expand-btn text-text-secondary hover:bg-surface-subtle hover:text-text-body rounded-default flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0.5 transition-colors duration-100"
      :aria-label="expanded ? t('common.collapse') : t('common.expand')"
      @click.stop="emit('toggle')"
    >
      <OIcon :name="expanded ? 'expand-less' : 'expand-more'" size="xs" />
    </button>
    <span class="text-text-secondary shrink-0 text-xs whitespace-nowrap tabular-nums">{{
      time
    }}</span>
    <OTruncatedText
      class="flex-1 font-mono text-xs"
      :tooltip="false"
      data-test="explorer-result-record"
    >
      <LogsHighLighting :data="record" :show-braces="true" />
    </OTruncatedText>
    <span
      class="text-text-secondary hover:text-accent flex w-8 shrink-0 cursor-pointer items-center justify-center"
      :data-test="openDataTest"
      @click.stop="emit('open')"
    >
      <OIcon name="chevron-right" size="sm" />
      <OTooltip :content="openLabel" />
    </span>
  </div>
</template>
