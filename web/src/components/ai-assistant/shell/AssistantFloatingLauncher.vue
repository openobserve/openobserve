<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    ref="root"
    class="flex max-w-[calc(100vw-2rem)] flex-wrap-reverse items-center justify-end gap-2"
    data-test="assistant-launcher"
  >
    <OButton
      v-if="othersShown && othersCount > 0"
      ref="toggleButton"
      variant="outline"
      size="sm"
      :class="['gap-1.5', CHIP_FILL]"
      :aria-expanded="expanded ? 'true' : 'false'"
      :data-signal="othersSignal ?? undefined"
      data-test="assistant-launcher-toggle"
      @click="emit('toggle')"
    >
      <AssistantStatusDot v-if="othersSignal" :state="othersSignal" placement="inline" />
      <AssistantSpark v-else :size="16" />
      <span>{{ t("assistant.threadsBar.title") }}</span>
      <span class="text-text-secondary tabular-nums" data-test="assistant-launcher-count">{{
        othersCount
      }}</span>
    </OButton>
    <div
      v-for="item in minimised"
      :key="item.sid"
      :class="[
        'bg-surface-base rounded-default flex h-8 max-w-60 min-w-0 items-center border shadow-md',
        item.signal === 'approval' ? 'border-assistant-signal-attention' : 'border-border-default',
      ]"
      :data-sid="item.sid"
      :data-signal="item.signal"
      data-test="assistant-tray-chip"
    >
      <OButton
        variant="ghost"
        size="sm"
        class="min-w-0 flex-1 justify-start! gap-1.5 ps-2! pe-1!"
        data-test="assistant-tray-chip-restore"
        @click="emit('restore', item.sid)"
      >
        <AssistantStatusDot
          v-if="SIGNAL[item.signal]"
          :state="SIGNAL[item.signal]!"
          placement="inline"
        />
        <OTruncatedText class="text-text-heading min-w-0 font-normal">{{
          item.title
        }}</OTruncatedText>
        <span v-if="STATE_WORD[item.signal]" class="sr-only"
          >, {{ t(STATE_WORD[item.signal]!) }}</span
        >
      </OButton>
      <AssistantIconButton
        :label="t('assistant.tray.close', { title: raw(item.title) })"
        :icon="assistantGlyph.close"
        no-tooltip
        class="me-0.5 shrink-0"
        data-test="assistant-tray-chip-close"
        @click="emit('close', item.sid)"
      />
    </div>
  </div>
</template>

<script lang="ts">
import type { AssistantSignal } from "@/components/ai-assistant/common/AssistantStatusDot.types";
import type { Sid } from "@/composables/assistant";
import type { I18nKey } from "@/types/i18n";

import type { ThreadPill } from "./threadsBar";

export interface AssistantFloatingLauncherProps {
  /** Minimised windows, oldest first; each is its own chip. */
  minimised: ThreadPill[];
  /** Chats and live incidents not on screen, behind the Threads chip. */
  othersCount: number;
  /** The most urgent signal among them. */
  othersSignal: AssistantSignal | null;
  /** A chat container is open, which already says what the Threads chip would. */
  othersShown: boolean;
  expanded: boolean;
}

const SIGNAL: Record<ThreadPill["signal"], AssistantSignal | null> = {
  running: "working",
  approval: "attention",
  failed: "failed",
  unread: "unread",
  idle: null,
};

const STATE_WORD: Partial<Record<ThreadPill["signal"], I18nKey>> = {
  running: "assistant.history.state.answering",
  approval: "assistant.history.state.needsYou",
  failed: "assistant.history.state.failed",
};

// The outline variant paints bg-transparent, which outranks a plain bg utility.
const CHIP_FILL =
  "bg-surface-base! enabled:hover:bg-button-outline-hover-bg! enabled:active:bg-button-outline-active-bg! shadow-md";

const MAIN_SELECTOR = "main[data-test='main-content']";
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import AssistantSpark from "@/components/ai-assistant/common/AssistantSpark.vue";
import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OButton from "@/lib/core/Button/OButton.vue";
import { publishFloatingObstacle } from "@/lib/core/Table/composables/useFloatingClearance";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped } from "@/types/i18n";

defineProps<AssistantFloatingLauncherProps>();

const emit = defineEmits<{ toggle: []; restore: [sid: Sid]; close: [sid: Sid] }>();

const { t } = useI18nTyped();
const root = ref<HTMLElement | null>(null);
const toggleButton = ref<{ $el?: HTMLElement } | null>(null);

// Scoped to the page so pagers in overlays and drawers, which sit above the tray, keep their full width.
let footprint: ResizeObserver | null = null;

function publishFootprint(): void {
  const main = document.querySelector(MAIN_SELECTOR);
  const rect = root.value?.getBoundingClientRect();
  publishFloatingObstacle(main && rect?.width ? { rect, scope: main } : null);
}

function focus(): void {
  const chip = root.value?.querySelector<HTMLElement>("[data-test='assistant-tray-chip-restore']");
  (toggleButton.value?.$el ?? chip)?.focus();
}

onMounted(() => {
  publishFootprint();
  window.addEventListener("resize", publishFootprint);
  if (typeof ResizeObserver === "undefined") return;
  // The tray's end offset follows the page's width a frame later, so a page resize re-reads it then too.
  footprint = new ResizeObserver(() => {
    publishFootprint();
    requestAnimationFrame(publishFootprint);
  });
  if (root.value) footprint.observe(root.value);
  const main = document.querySelector(MAIN_SELECTOR);
  if (main) footprint.observe(main);
});

onBeforeUnmount(() => {
  footprint?.disconnect();
  window.removeEventListener("resize", publishFootprint);
  publishFloatingObstacle(null);
});

defineExpose({ focus });
</script>
