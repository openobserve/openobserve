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
  <template v-if="shown">
    <OPopover
      :open="open && mdUp"
      side="bottom"
      align="end"
      :aria-label="t('assistant.runs.heading')"
      content-class="w-100 max-w-[calc(100vw-2rem)]"
      privacy="mask"
      @update:open="setOpen"
    >
      <template #anchor>
        <OButton
          ref="button"
          variant="ghost"
          size="sm"
          :aria-label="name"
          :aria-expanded="open"
          :data-state="signal"
          class="shrink-0 gap-1 max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          data-test="assistant-runs-button"
          @pointerdown="notePress"
          @click="toggle"
        >
          <AssistantStatusDot :state="signal" />
          <span aria-hidden="true" class="text-xs tabular-nums">{{ others.length }}</span>
          <OTooltip v-if="!open" side="bottom" :content="name" />
        </OButton>
      </template>
      <AssistantRunsMenu v-if="open && mdUp" @close="setOpen(false)" />
    </OPopover>
    <OSheet
      v-if="!mdUp"
      :open="open"
      :snap="snap"
      :snap-points="['half', 'full']"
      v-bind="{ ariaLabel: t('assistant.runs.heading') }"
      :expand-label="t('assistant.shell.sheetExpand')"
      :collapse-label="t('assistant.shell.sheetPeek')"
      data-test="assistant-runs-sheet"
      @update:snap="(next) => (snap = next)"
      @update:open="setOpen"
    >
      <template #header>
        <div class="flex justify-start px-2">
          <AssistantIconButton
            :label="t('assistant.runs.back')"
            :icon="assistantGlyph.back"
            data-test="assistant-runs-sheet-back"
            @click="setOpen(false)"
          />
        </div>
      </template>
      <AssistantRunsMenu v-if="open" @close="setOpen(false)" />
    </OSheet>
  </template>
  <AssistantStatusRegion ref="region" data-test="assistant-runs-status-region" />
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import AssistantStatusDot from "@/components/ai-assistant/common/AssistantStatusDot.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { provideAssistantSurface } from "@/components/ai-assistant/common/assistantSurface";
import AssistantStatusRegion from "@/components/ai-assistant/shell/AssistantStatusRegion.vue";
import { runsCounts, useAssistantRuns, useAssistantStore } from "@/composables/assistant";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OSheet from "@/lib/overlay/Sheet/OSheet.vue";
import type { SheetSnap } from "@/lib/overlay/Sheet/OSheet.types";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped } from "@/types/i18n";

import AssistantRunsMenu from "./AssistantRunsMenu.vue";
import { runSignal, runsSummary } from "./runsText";

// The list is teleported to body, so it carries the assistant colour roles with it.
provideAssistantSurface();

const { t } = useI18nTyped();
const store = useAssistantStore();
const runs = useAssistantRuns();
const { mdUp } = useBreakpoint();
const button = ref<InstanceType<typeof OButton> | null>(null);
const region = ref<InstanceType<typeof AssistantStatusRegion> | null>(null);
const open = ref(false);
const snap = ref<SheetSnap>("full");
let freedFor: string | null = null;
let openAtPress: boolean | null = null;

const activeSession = computed(() => {
  const sid = store.state.shell.activeSid;
  return sid ? store.state.sessions[sid] : undefined;
});
const others = computed(() =>
  runs.rows.value.filter((row) => row.sid !== store.state.shell.activeSid),
);
const counts = computed(() => runsCounts(others.value));
const signal = computed(() => runSignal(counts.value));
const name = computed(() =>
  t(
    "assistant.runs.button",
    {
      count: others.value.length,
      summary: runsSummary(counts.value, ["answering", "needs", "failed", "ready"], t),
    },
    others.value.length,
  ),
);
// A request from Show running chats opens the list even with nothing else to show.
const shown = computed(() => others.value.length > 0 || open.value);

function setOpen(next: boolean): void {
  open.value = next;
  if (!next && !mdUp.value)
    void nextTick(() => (button.value?.$el as HTMLElement | undefined)?.focus());
}

// The popover closes on the pointer going down outside it, so the click must not read that as closed.
function notePress(): void {
  openAtPress = open.value;
}

function toggle(): void {
  setOpen(!(openAtPress ?? open.value));
  openAtPress = null;
}

watch(
  () => runs.openRequested.value,
  (requested) => {
    if (!requested) return;
    runs.takeOpenRequest();
    setOpen(true);
  },
  { immediate: true },
);

// Once per refusal: a second chat ending changes nothing the reader has not been told (`95` §2.2).
watch(
  () => runs.active.value,
  (active, before) => {
    const session = activeSession.value;
    const turn = session?.turn;
    if (active >= before || turn?.state !== "refused" || turn.error.code !== "run_limit_member")
      return;
    if (freedFor === session?.turnMeta.turnId) return;
    freedFor = session?.turnMeta.turnId ?? null;
    region.value?.announce(t("assistant.limit.slotFree"));
  },
);
</script>
