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
  <OPopover
    :open="open"
    side="top"
    align="start"
    :aria-label="t('assistant.composer.hintsTitle')"
    content-class="w-[min(18rem,calc(100vw-1.5rem))] p-3"
    @update:open="onOpen"
  >
    <template #trigger>
      <OButton
        v-if="labelled"
        variant="ghost"
        size="sm"
        :icon-left="assistantGlyph.hints"
        class="max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="assistant-composer-hints"
      >
        {{ t("assistant.composer.hintsTitle") }}
      </OButton>
      <AssistantIconButton
        v-else
        :label="t('assistant.composer.hintsLabel')"
        :icon="assistantGlyph.hints"
        data-test="assistant-composer-hints"
      />
    </template>
    <div class="flex flex-col gap-2" data-test="assistant-composer-hints-popover">
      <OText variant="label" as="h2">{{ t("assistant.composer.hintsTitle") }}</OText>
      <ul class="flex flex-col gap-1.5">
        <li
          v-for="row in rows"
          :key="row.id"
          class="flex items-center justify-between gap-3 text-xs"
          :data-test="`assistant-composer-hint-${row.id}`"
        >
          <span class="text-text-body">{{ row.label }}</span>
          <OShortcut :id="row.id" tone="strong" />
        </li>
      </ul>
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OButton from "@/lib/core/Button/OButton.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { useI18nTyped } from "@/types/i18n";

withDefaults(
  defineProps<{
    /** The roomy full view shows the label "Keys" (`40` §1.2). */
    labelled?: boolean;
  }>(),
  { labelled: false },
);

const { t } = useI18nTyped();
const open = ref(false);

// The three display-only registry rows; the cheatsheet lists the same ids (CT-09 AC 8).
const rows = computed(() => [
  { id: "assistantComposerSend", label: t("shortcuts.actions.assistantComposerSend") },
  { id: "assistantComposerNewline", label: t("shortcuts.actions.assistantComposerNewline") },
  { id: "assistantComposerRecall", label: t("shortcuts.actions.assistantComposerRecall") },
]);

function onOpen(value: boolean): void {
  open.value = value;
  if (value) trackAssistant("ai_context_inspected", { target: "hints" });
}

defineExpose({ close: () => (open.value = false), isOpen: () => open.value });
</script>
