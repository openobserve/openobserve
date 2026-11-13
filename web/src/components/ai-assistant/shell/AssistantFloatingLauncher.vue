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
    class="relative"
    role="presentation"
    data-test="assistant-launcher"
    @pointerenter="enter"
    @pointerleave="leave"
    @focusin="enter"
    @focusout="onFocusOut"
    @keydown.esc="close"
  >
    <div
      v-if="open"
      class="absolute end-0 bottom-full flex flex-col-reverse items-end gap-2 pb-2 md:contents"
      role="group"
      :aria-label="t('assistant.launcher.previews')"
      data-test="assistant-launcher-previews"
    >
      <div
        v-for="(item, index) in shown"
        :key="item.sid"
        :class="['flex gap-2', index === 0 ? 'flex-col items-end' : 'items-center', SLOT[index]]"
        :data-slot="SLOT_NAME[index]"
        data-test="assistant-launcher-slot"
      >
        <OButton
          v-if="index === 0 && more > 0"
          variant="outline"
          size="chip"
          :class="['assistant-pop-in origin-bottom-right', PILL, STAGGER[2]]"
          :aria-label="t('assistant.launcher.more', { count: more })"
          data-test="assistant-launcher-more"
          @click="onToggle"
        >
          {{ t("assistant.tray.more", { count: more }) }}
        </OButton>
        <OButton
          variant="outline"
          size="sm"
          :class="[
            'assistant-pop-in max-w-[min(16rem,calc(100vw-3rem))] origin-bottom-right gap-1.5',
            PILL,
            STAGGER[index],
          ]"
          :aria-label="t('assistant.launcher.restore', { title: raw(item.title) })"
          :data-signal="item.signal"
          data-test="assistant-launcher-preview"
          @click="onRestore(item.sid)"
        >
          <AssistantStatusDot
            v-if="SIGNAL[item.signal]"
            :state="SIGNAL[item.signal]!"
            placement="inline"
          />
          <span>{{ previewTitle(item.title) }}</span>
        </OButton>
      </div>
    </div>
    <OButton
      ref="toggleButton"
      variant="outline"
      size="icon"
      :class="[
        'rounded-surface! border-border-default! enabled:hover:border-accent! size-12! border! shadow-md!',
        PILL,
      ]"
      :aria-label="iconLabel"
      :aria-expanded="expanded ? 'true' : 'false'"
      :data-working="working > 0 ? 'true' : 'false'"
      data-test="assistant-launcher-toggle"
      @click="onToggle"
    >
      <img :src="logoSrc" alt="" class="size-8" data-test="assistant-launcher-logo" />
    </OButton>
    <span
      v-if="working > 0"
      class="bg-surface-base border-border-strong ring-surface-base pointer-events-none absolute -end-1.5 -bottom-1.5 flex h-4 items-center gap-0.5 rounded-full border px-1.5 shadow-sm ring-2"
      data-test="assistant-launcher-working-dot"
    >
      <span class="bg-text-heading size-1 rounded-full motion-safe:animate-pulse" />
      <span
        class="bg-text-heading size-1 rounded-full motion-safe:animate-pulse motion-safe:[animation-delay:200ms]"
      />
      <span
        class="bg-text-heading size-1 rounded-full motion-safe:animate-pulse motion-safe:[animation-delay:400ms]"
      />
    </span>
    <OBadge
      v-if="items.length > 0"
      variant="primary"
      size="sm"
      class="ring-surface-base pointer-events-none absolute -end-2 -top-2 h-6! min-w-6 justify-center px-1.5! py-0! text-xs ring-2"
      :data-state="waiting > 0 ? 'needsYou' : 'calm'"
      data-test="assistant-launcher-badge"
    >
      {{ items.length }}
    </OBadge>
    <span class="sr-only" aria-live="polite" data-test="assistant-launcher-live">{{
      working > 0 ? t("assistant.launcher.working", { count: working }, working) : ""
    }}</span>
  </div>
</template>

<script lang="ts">
import type { AssistantSignal } from "@/components/ai-assistant/common/AssistantStatusDot.types";
import type { Sid } from "@/composables/assistant";

import type { ThreadPill } from "./threadsBar";

export interface AssistantFloatingLauncherProps {
  /** Every listed chat, most urgent first. */
  items: ThreadPill[];
  /** The Threads panel is open, so the previews step aside. */
  expanded: boolean;
}

/** Previews shown before the rest collapse into "+N". */
export const LAUNCHER_PREVIEWS = 2;

/** Characters of a title kept in a preview. */
export const PREVIEW_CHARS = 26;

const SIGNAL: Record<ThreadPill["signal"], AssistantSignal | null> = {
  running: "working",
  approval: "attention",
  unread: "unread",
  idle: null,
};

// The outline variant paints bg-transparent, which outranks a plain bg utility, so the opaque fills need !important.
const PILL =
  "bg-surface-base! enabled:hover:bg-button-outline-hover-bg! enabled:active:bg-button-outline-active-bg! shadow-lg";

const SLOT = [
  "md:absolute md:bottom-full md:end-0 md:pb-2",
  "md:absolute md:end-full md:top-1/2 md:-translate-y-1/2 md:pe-2",
];

const SLOT_NAME = ["above", "left"];

const STAGGER = [
  "assistant-pop-in-0",
  "assistant-pop-in-1",
  "assistant-pop-in-2",
  "assistant-pop-in-3",
];

// Time the pointer may spend crossing the gap between the icon and the previews.
const LEAVE_GRACE_MS = 150;

/** The first PREVIEW_CHARS characters of a title, with an ellipsis when cut. */
export function previewTitle(title: string): string {
  const chars = [...title.trim()];
  return chars.length > PREVIEW_CHARS
    ? `${chars.slice(0, PREVIEW_CHARS).join("").trimEnd()}…`
    : chars.join("");
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
import { useTheme } from "@/composables/useTheme";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";

const props = defineProps<AssistantFloatingLauncherProps>();

const emit = defineEmits<{ toggle: []; restore: [sid: Sid] }>();

const { t } = useI18nTyped();
const { isDark } = useTheme();
const logoSrc = computed(() =>
  getImageURL(isDark.value ? "images/common/o2_ai_logo_dark.svg" : "images/common/o2_ai_logo.svg"),
);
const toggleButton = ref<{ $el?: HTMLElement } | null>(null);
const wanted = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

const working = computed(() => props.items.filter((i) => i.signal === "running").length);
const waiting = computed(() => props.items.filter((i) => i.signal === "approval").length);
const iconLabel = computed(() =>
  working.value > 0
    ? t("assistant.launcher.iconWorking", { count: working.value }, working.value)
    : t("assistant.threadsBar.title"),
);
const shown = computed(() => props.items.slice(0, LAUNCHER_PREVIEWS));
const more = computed(() => Math.max(props.items.length - LAUNCHER_PREVIEWS, 0));
const open = computed(() => wanted.value && !props.expanded && props.items.length > 0);

function enter(): void {
  clearTimeout(timer);
  wanted.value = true;
}

function leave(): void {
  clearTimeout(timer);
  timer = setTimeout(close, LEAVE_GRACE_MS);
}

function close(): void {
  clearTimeout(timer);
  wanted.value = false;
}

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  const root = event.currentTarget as HTMLElement;
  if (!(next instanceof Node) || !root.contains(next)) leave();
}

function onToggle(): void {
  close();
  emit("toggle");
}

function onRestore(sid: Sid): void {
  close();
  emit("restore", sid);
}

onBeforeUnmount(() => clearTimeout(timer));

defineExpose({ focus: () => toggleButton.value?.$el?.focus() });
</script>
