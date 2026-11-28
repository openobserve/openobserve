<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- The explorer drawer's detail bar: back, the item's position with prev/next, and Copy link. -->
<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";

const props = defineProps<{
  title: I18nText;
  subtitle?: I18nText;
  /** Index in the loaded page; prev/next step within it. */
  index: number;
  /** Items on the loaded page. */
  count: number;
  /** Items before the loaded page, so the position shown is the item's place in the whole result. */
  offset?: number;
  /** The whole result's size: null while unknown (position only); omitted, the page's count. */
  total?: number | null;
  /** Whether prev / next can step, past the page edge too. */
  hasPrev: boolean;
  hasNext: boolean;
  prevLabel: I18nText;
  nextLabel: I18nText;
  dataTestPrefix: string;
}>();

const emit = defineEmits<{ back: []; prev: []; next: []; copyLink: [] }>();

const { t } = useI18nTyped();

const position = computed(() => {
  const at = (props.offset ?? 0) + props.index + 1;
  if (props.total === null) return String(at);
  return `${at} / ${props.total ?? props.count}`;
});
</script>

<template>
  <div
    class="border-border-default bg-surface-panel flex shrink-0 items-center gap-2 border-b px-2 py-1"
  >
    <OButton
      size="icon-xs"
      variant="ghost"
      icon-left="arrow-back"
      :aria-label="t('panel.logExplorer.detail.back')"
      :data-test="`${dataTestPrefix}-detail-back`"
      @click="emit('back')"
    >
      <OTooltip :content="t('panel.logExplorer.detail.back')" />
    </OButton>
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <span class="text-text-heading text-xs font-medium tabular-nums">{{ title }}</span>
      <OTruncatedText v-if="subtitle" class="text-text-secondary text-xs">{{
        subtitle
      }}</OTruncatedText>
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <OButton
        size="icon-xs"
        variant="outline"
        icon-left="chevron-left"
        :disabled="!hasPrev"
        :aria-label="prevLabel"
        :data-test="`${dataTestPrefix}-detail-prev`"
        @click="emit('prev')"
      >
        <OTooltip :content="prevLabel" />
      </OButton>
      <span
        class="text-text-secondary min-w-12 px-1 text-center text-xs whitespace-nowrap tabular-nums"
        :data-test="`${dataTestPrefix}-detail-position`"
        >{{ position }}</span
      >
      <OButton
        size="icon-xs"
        variant="outline"
        icon-left="chevron-right"
        :disabled="!hasNext"
        :aria-label="nextLabel"
        :data-test="`${dataTestPrefix}-detail-next`"
        @click="emit('next')"
      >
        <OTooltip :content="nextLabel" />
      </OButton>
    </div>
    <OButton
      size="sm-toolbar"
      variant="outline"
      icon-left="link"
      :data-test="`${dataTestPrefix}-detail-copy-link`"
      @click="emit('copyLink')"
    >
      {{ t("panel.logExplorer.detail.copyLink") }}
    </OButton>
  </div>
</template>
