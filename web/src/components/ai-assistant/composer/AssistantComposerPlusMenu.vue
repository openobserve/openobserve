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
  <ODropdown
    v-if="items.length > 0"
    side="top"
    align="start"
    privacy="mask"
    @close-auto-focus="onClosed"
  >
    <template #trigger>
      <AssistantIconButton
        :label="t('assistant.composer.plus')"
        :icon="assistantGlyph.addContext"
        size="md"
        :disabled="disabled"
        data-test="assistant-composer-plus"
      />
    </template>
    <ODropdownItem
      v-for="item in items"
      :key="item.id"
      :icon-left="item.icon"
      :data-test="item.test"
      @select="choose(item.id)"
    >
      {{ item.label }}
    </ODropdownItem>
  </ODropdown>
</template>

<script lang="ts">
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";

export type ComposerPlusAction = "attach" | "context" | "time" | "recall";

export interface AssistantComposerPlusMenuProps {
  /** What the menu offers; it always lists them as Attach Image, Add Context, Time Range, Recent Prompts. */
  actions: readonly ComposerPlusAction[];
  disabled?: boolean;
}

export interface AssistantComposerPlusMenuEmits {
  (e: "select", action: ComposerPlusAction): void;
}

// The listing order; the image and recall ids are the ones their old bottom-row buttons had.
const ITEMS = [
  { id: "attach", icon: assistantGlyph.chipImage, test: "assistant-attach-image" },
  { id: "context", icon: assistantGlyph.chipStream, test: "assistant-composer-add-context" },
  { id: "time", icon: assistantGlyph.chipTime, test: "assistant-composer-time-range" },
  { id: "recall", icon: assistantGlyph.history, test: "assistant-recall-open" },
] as const satisfies readonly { id: ComposerPlusAction; icon: string; test: string }[];
</script>

<script setup lang="ts">
import { computed } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantComposerPlusMenuProps>(), { disabled: false });

const emit = defineEmits<AssistantComposerPlusMenuEmits>();

const { t } = useI18nTyped();

const items = computed(() => {
  const label = {
    attach: t("assistant.composer.attachImage"),
    context: t("assistant.composer.addContext"),
    time: t("assistant.composer.timeRange"),
    recall: t("assistant.composer.recentPrompts"),
  };
  return ITEMS.filter((item) => props.actions.includes(item.id)).map((item) => ({
    ...item,
    label: label[item.id],
  }));
});

let chosen: ComposerPlusAction | null = null;

function choose(action: ComposerPlusAction): void {
  chosen = action;
  emit("select", action);
}

// Every item but Attach Image moves focus on (the textbox, the time picker, the sheet), so the closing menu must not pull it back.
function onClosed(event: Event): void {
  if (chosen && chosen !== "attach") event.preventDefault();
  chosen = null;
}
</script>
