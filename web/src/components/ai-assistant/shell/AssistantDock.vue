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
  <template v-if="mountable">
    <div
      v-if="lgUp && isOpen"
      ref="column"
      :data-host="host.id"
      data-test="assistant-dock-column"
      class="border-border-default flex h-full min-h-0 w-[min(28rem,40%)] min-w-80 shrink-0 flex-col border-s"
    >
      <AssistantShell placement="docked" :host="host" :data-host="host.id" />
    </div>
    <OSheet
      v-else-if="!lgUp"
      inline
      :open="isOpen"
      :snap="store.state.shell.sheetSnap"
      :anchor-above="anchorAbove"
      :align-to="host.dockSlot.value"
      v-bind="{ ariaLabel: t('assistant.name') }"
      :expand-label="t('assistant.shell.sheetExpand')"
      :collapse-label="t('assistant.shell.sheetPeek')"
      data-test="assistant-dock-sheet"
      :close-on-escape="false"
      @update:snap="(snap) => store.setSheetSnap(snap)"
      @update:open="(open) => !open && closeDock('close')"
    >
      <template #peek>
        <span
          class="flex min-w-0 flex-1 items-center gap-2 text-start"
          data-test="assistant-dock-sheet-status"
        >
          <AssistantMark size="sm" />
          <OTruncatedText class="text-text-heading min-w-0 flex-1 text-sm font-medium">{{
            peekTitle
          }}</OTruncatedText>
        </span>
      </template>
      <div ref="column" class="flex min-h-0 flex-1 flex-col">
        <AssistantShell placement="docked" :host="host" sheet :data-host="host.id" />
      </div>
    </OSheet>
  </template>
</template>

<script lang="ts">
import type { AssistantHostAdapter } from "@/composables/assistant";

export interface AssistantDockProps {
  host: AssistantHostAdapter;
  /** The host's footer the sheet stays above below `lg`; the topmost drawer's footer by default. */
  anchorAbove?: string | HTMLElement;
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import AssistantMark from "@/components/ai-assistant/common/AssistantMark.vue";
import {
  reportDockWidth,
  stopLadderEscape,
  useAssistantCapability,
  useAssistantPanelWidth,
  useAssistantStore,
} from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSheet from "@/lib/overlay/Sheet/OSheet.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";

import AssistantShell from "./AssistantShell.vue";

const UNMOUNTED_GATES: ReadonlySet<string> = new Set(["loading", "not_entitled", "not_configured"]);

const props = withDefaults(defineProps<AssistantDockProps>(), { anchorAbove: undefined });

const { t } = useI18nTyped();
const store = useAssistantStore();
const capability = useAssistantCapability();
const { lgUp } = useBreakpoint();
const column = ref<HTMLElement | null>(null);
let sizes: ResizeObserver | null = null;

// The width readers' resize signal watches the dock's reported width.
useAssistantPanelWidth();

const mountable = computed(() => !UNMOUNTED_GATES.has(capability.gate.value));
const peekTitle = computed(
  () => store.state.sessions[store.state.shell.activeSid ?? ""]?.title ?? props.host.objectTitle(),
);
const isOpen = computed(() => {
  const placement = store.state.shell.placement;
  return placement.kind === "docked" && placement.hostId === props.host.id;
});

function closeDock(reason: "close" | "escape"): void {
  if (!isOpen.value) return;
  trackAssistant("ai_container_closed", { reason });
  store.close(reason);
}

function measure(el: HTMLElement): void {
  if (lgUp.value) reportDockWidth(props.host.id, el.getBoundingClientRect().width / 16);
}

// Escape anywhere in the dock (the sheet's own Show less/more included) stops here, so the host never closes with it.
let escapeScope: HTMLElement | null = null;

watch(column, (el, old) => {
  escapeScope?.removeEventListener("keydown", stopLadderEscape);
  escapeScope = el?.closest<HTMLElement>('[data-test="assistant-dock-sheet"]') ?? el;
  escapeScope?.addEventListener("keydown", stopLadderEscape);
  if (old) sizes?.unobserve(old);
  if (!el) return reportDockWidth(props.host.id, 0);
  if (typeof ResizeObserver !== "undefined") {
    sizes ??= new ResizeObserver(() => column.value && measure(column.value));
    sizes.observe(el);
  }
  measure(el);
});

// The docked shell mounts with the open, after the request to focus it, so the dock takes that request itself.
let focusSeen = store.focusRequest.value?.seq;

async function focusIfAsked(): Promise<void> {
  const seq = store.focusRequest.value?.seq;
  if (seq === undefined || seq === focusSeen) return;
  focusSeen = seq;
  await nextTick();
  column.value?.querySelector<HTMLElement>("[data-assistant-composer]")?.focus();
}

// A close from inside the chat returns focus to the toggle that opened it, never to the page.
watch(
  isOpen,
  async (open, was) => {
    if (open && !was && !lgUp.value) store.setSheetSnap("half");
    if (open && !was) void focusIfAsked();
    if (open || !was) return;
    const active = document.activeElement;
    const inside = !!active && !!column.value?.contains(active);
    if (!inside && active && active !== document.body) return;
    await nextTick();
    const invoker = store.state.shell.invoker?.el.deref();
    if (invoker?.isConnected) invoker.focus();
    else props.host.focusEditor();
  },
  { flush: "pre" },
);

watch(
  () => store.focusRequest.value?.seq,
  () => {
    if (isOpen.value) void focusIfAsked();
  },
);

onBeforeUnmount(() => {
  escapeScope?.removeEventListener("keydown", stopLadderEscape);
  sizes?.disconnect();
  reportDockWidth(props.host.id, 0);
});
</script>
