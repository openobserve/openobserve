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
  <OSheet
    :open="open"
    :snap="snap"
    :snap-points="['half', 'full']"
    v-bind="{ ariaLabel: t('assistant.composer.recentPrompts') }"
    :expand-label="t('assistant.shell.sheetExpand')"
    :collapse-label="t('assistant.shell.sheetPeek')"
    close-on-escape
    data-test="assistant-recall-sheet"
    @update:snap="(next) => (snap = next)"
    @update:open="(value) => emit('update:open', value)"
  >
    <template #header>
      <div class="flex items-center justify-between gap-2 px-3">
        <OText variant="card-title" as="h2">{{ t("assistant.composer.recentPrompts") }}</OText>
        <AssistantIconButton
          :label="t('common.close')"
          :icon="assistantGlyph.close"
          data-test="assistant-recall-sheet-close"
          @click="emit('update:open', false)"
        />
      </div>
    </template>
    <ul ref="list" class="flex flex-col gap-1 px-3 pb-3" data-dd-privacy="mask">
      <li v-for="(entry, index) in entries" :key="`${entry.at}-${index}`">
        <OButton
          variant="ghost"
          block
          class="h-auto! min-h-11 flex-col items-start! justify-center! gap-0.5 py-2 text-start whitespace-normal!"
          :data-test="`assistant-recall-entry-${index}`"
          @click="emit('select', index)"
        >
          <span class="text-text-body text-sm break-words">{{ entry.text }}</span>
          <span v-if="entry.chips.length" class="text-text-secondary text-xs break-words">{{
            chipLabels(entry)
          }}</span>
        </OButton>
      </li>
    </ul>
  </OSheet>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import type { RecallEntry } from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSheet from "@/lib/overlay/Sheet/OSheet.vue";
import type { SheetSnap } from "@/lib/overlay/Sheet/OSheet.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const props = defineProps<{ open: boolean; entries: RecallEntry[] }>();

const emit = defineEmits<{
  (e: "update:open", open: boolean): void;
  /** The recall index of the tapped entry; the composer stages it (CT-11 AC 10). */
  (e: "select", index: number): void;
}>();

const { t } = useI18nTyped();
const snap = ref<SheetSnap>("half");
const list = ref<HTMLElement | null>(null);

// The sheet is non-modal, so focus moves in by hand; its Escape then closes it, never the assistant.
watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    list.value?.querySelector<HTMLElement>("button")?.focus();
  },
);

function chipLabels(entry: RecallEntry): I18nText {
  return raw(entry.chips.map((chip) => chip.label).join(", "));
}
</script>
