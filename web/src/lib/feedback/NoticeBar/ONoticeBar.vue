<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";

import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

import type { NoticeBarProps, NoticeTone } from "./ONoticeBar.types";

const props = withDefaults(defineProps<NoticeBarProps>(), {
  dataTest: undefined,
  toggleDataTest: "o-notice-bar-toggle",
});

const { t } = useI18nTyped();
const expanded = ref(false);
const listId = useId();

const RANK: Record<NoticeTone, number> = { error: 0, warning: 1, info: 2 };
const VARIANT = { error: "error-soft", warning: "warning", info: "info" } as const;
const ICON: Record<NoticeTone, string> = {
  error: "error-outline",
  warning: "warning-amber",
  info: "info-outline",
};

// The most severe notice leads, so a collapsed bar never hides an error behind an info line.
const ordered = computed(() => [...props.notices].sort((a, b) => RANK[a.tone] - RANK[b.tone]));
const lead = computed(() => ordered.value[0]);
const rest = computed(() => ordered.value.slice(1));
// Past this length a one-line row is likely cut off, so the bar offers to expand it.
const LONG_TEXT = 110;
const canExpand = computed(
  () => rest.value.length > 0 || ordered.value.some((n) => String(n.text).length > LONG_TEXT),
);
watch(canExpand, (can) => {
  if (!can) expanded.value = false;
});
const toneLabel = (tone: NoticeTone) => t(`common.notices.tone.${tone}`);
</script>

<template>
  <!-- Polite: the bar's text changes as data loads, and an assertive region would re-announce each time. -->
  <OBanner
    v-if="lead"
    :variant="VARIANT[lead.tone]"
    :icon="ICON[lead.tone]"
    dense
    inline-actions
    role="status"
    :data-test="dataTest"
  >
    <template #icon>
      <OIcon :name="ICON[lead.tone]" :label="toneLabel(lead.tone)" size="sm" />
    </template>
    <div :id="listId" class="flex min-w-0 flex-col gap-1">
      <div
        v-for="(notice, index) in expanded ? ordered : [lead]"
        :key="notice.key"
        class="flex min-w-0 items-center gap-2"
        :data-test="notice.dataTest"
      >
        <OIcon
          v-if="index > 0"
          :name="ICON[notice.tone]"
          :label="toneLabel(notice.tone)"
          size="xs"
          class="shrink-0"
        />
        <span v-if="expanded" class="min-w-0">{{ notice.text }}</span>
        <span v-else class="min-w-0 truncate"
          >{{ notice.text }}<OTooltip :content="notice.text"
        /></span>
        <OButton
          v-if="notice.actionLabel && notice.onAction"
          variant="outline"
          size="xs"
          class="shrink-0"
          :data-test="notice.dataTest ? `${notice.dataTest}-action` : undefined"
          @click="notice.onAction"
        >
          {{ notice.actionLabel }}
        </OButton>
      </div>
    </div>
    <template v-if="canExpand" #actions>
      <OButton
        variant="ghost"
        size="xs"
        :icon-right="expanded ? 'expand-less' : 'expand-more'"
        :aria-expanded="expanded"
        :aria-controls="listId"
        :data-test="toggleDataTest"
        @click="expanded = !expanded"
      >
        {{
          expanded
            ? t("common.notices.less")
            : rest.length
              ? t("common.notices.more", { n: rest.length })
              : t("common.notices.readMore")
        }}
      </OButton>
    </template>
  </OBanner>
</template>
