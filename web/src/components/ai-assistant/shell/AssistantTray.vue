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
  <section
    v-if="bars.length"
    ref="root"
    :aria-label="t('assistant.tray.label')"
    data-test="assistant-tray"
    class="fixed end-[calc(var(--o-tray-end)*1rem)] bottom-2 z-5000 flex items-center gap-2"
  >
    <div
      v-for="(bar, index) in shown"
      :key="bar.sid"
      data-test="assistant-tray-bar"
      class="bg-surface-base border-border-default rounded-surface flex h-10 w-50 min-w-0 items-center gap-1 border ps-2 pe-1 shadow-lg xl:w-60"
    >
      <OButton
        :ref="(el) => setBar(index, el)"
        variant="ghost"
        size="sm"
        :tabindex="index === rover ? 0 : -1"
        :aria-label="bar.name"
        class="min-w-0 flex-1 justify-start! gap-1.5 px-1!"
        data-test="assistant-tray-restore"
        @click="emit('restore', bar.sid)"
        @focus="rover = index"
        @keydown="onKey"
      >
        <span class="relative inline-flex shrink-0">
          <AssistantMark size="sm" />
          <AssistantStatusDot v-if="bar.signal" :state="bar.signal" placement="corner" />
        </span>
        <OTruncatedText class="min-w-0">{{ bar.title }}</OTruncatedText>
      </OButton>
      <AssistantIconButton
        :label="t('assistant.tray.close', { title: raw(String(bar.title)) })"
        :icon="assistantGlyph.close"
        data-test="assistant-tray-close"
        @click="emit('close', bar.sid)"
      />
    </div>
    <ODropdown v-if="hidden.length" align="end">
      <template #trigger>
        <OButton variant="outline" size="sm" data-test="assistant-tray-more">
          {{ t("assistant.tray.more", { count: hidden.length }) }}
        </OButton>
      </template>
      <ODropdownItem
        v-for="bar in hidden"
        :key="bar.sid"
        data-test="assistant-tray-more-item"
        @select="emit('restore', bar.sid)"
      >
        {{ bar.title }}
      </ODropdownItem>
    </ODropdown>
  </section>
</template>

<script lang="ts">
import type { AssistantSignal } from "@/components/ai-assistant/common/AssistantStatusDot.types";
import type { AssistantSession, Sid } from "@/composables/assistant";

export interface AssistantTrayProps {
  /** Minimised chats, oldest first. */
  order: Sid[];
  /** 2 at 1024–1279, where the rest sit behind "+{count}". */
  visibleBars: number;
}

/** The bar's mark, in the shapes that keep needs-you and answer-ready apart without colour. */
export function traySignal(session: AssistantSession | undefined): AssistantSignal | null {
  if (!session) return null;
  if (session.pendingApproval || session.pendingConsent) return "attention";
  const state = session.turn.state;
  if (session.unread) return state === "failed" || state === "refused" ? "failed" : "unread";
  return ["idle", "done", "failed", "refused", "stopped"].includes(state) ? null : "working";
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import AssistantMark from "@/components/ai-assistant/common/AssistantMark.vue";
import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { useAssistantName, useAssistantStore } from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";

const STATUS_KEYS: Record<AssistantSignal | "idle", I18nKey> = {
  working: "assistant.tray.status.working",
  attention: "assistant.tray.status.needsYou",
  failed: "assistant.tray.status.failed",
  unread: "assistant.tray.status.ready",
  idle: "assistant.tray.status.idle",
};

const props = defineProps<AssistantTrayProps>();

const emit = defineEmits<{ restore: [sid: Sid]; close: [sid: Sid] }>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const store = useAssistantStore();
const root = ref<HTMLElement | null>(null);
const rover = ref(0);
const barEls: (HTMLElement | null)[] = [];

const bars = computed(() =>
  props.order.map((sid) => {
    const session = store.state.sessions[sid];
    const title = session?.title ?? t("assistant.thread.newChatTitle");
    const signal = traySignal(session);
    return {
      sid,
      title,
      signal,
      name: t("assistant.tray.restore", {
        agent: product,
        title: raw(String(title)),
        status: t(STATUS_KEYS[signal ?? "idle"]),
      }),
    };
  }),
);
const shown = computed(() => bars.value.slice(0, props.visibleBars));
const hidden = computed(() => bars.value.slice(props.visibleBars));

watch(
  () => shown.value.length,
  (length) => {
    rover.value = Math.min(rover.value, Math.max(length - 1, 0));
  },
);

function setBar(index: number, el: unknown): void {
  barEls[index] = (el as { $el?: HTMLElement } | null)?.$el ?? null;
}

function focusBar(index: number): void {
  rover.value = index;
  barEls[index]?.focus();
}

function onKey(event: KeyboardEvent): void {
  const count = shown.value.length;
  if (count === 0) return;
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    focusBar((rover.value + (event.key === "ArrowRight" ? 1 : count - 1)) % count);
  } else if (event.key === "Delete") {
    const bar = shown.value[rover.value];
    if (bar) emit("close", bar.sid);
  }
}

defineExpose({ el: root });
</script>
