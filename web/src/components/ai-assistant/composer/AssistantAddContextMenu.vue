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
    :aria-label="t('assistant.composer.addContext')"
    content-class="w-[min(22rem,calc(100vw-1.5rem))] p-2"
    privacy="mask"
    @update:open="onOpen"
  >
    <template #trigger>
      <AssistantIconButton
        :label="t('assistant.composer.addContext')"
        :icon="assistantGlyph.addContext"
        :no-tooltip="open"
        data-test="assistant-add-context"
      />
    </template>
    <div class="flex flex-col gap-2" data-test="assistant-add-context-menu">
      <OInput
        ref="search"
        v-model="query"
        size="sm"
        :placeholder="t('assistant.composer.addMenuSearch')"
        :input-attrs="searchAttrs"
        data-test="assistant-add-context-search"
        @keydown="onKeydown"
      />
      <AssistantMentionMenu
        ref="menu"
        :open="open"
        :query="query"
        :org="org"
        :listbox-id="listboxId"
        inline
        with-image
        @select="pick"
      />
      <ul
        class="border-border-default flex flex-col gap-1 border-t px-1 pt-2"
        data-test="assistant-add-context-keys"
      >
        <li
          v-for="row in keyRows"
          :key="row.id"
          class="flex items-center justify-between gap-3 text-xs"
          :data-test="`assistant-composer-hint-${row.id}`"
        >
          <span class="text-text-secondary">{{ row.label }}</span>
          <OShortcut v-if="row.shortcut" :id="row.id" tone="strong" />
          <kbd v-else class="text-text-body font-mono">{{ row.keys }}</kbd>
        </li>
      </ul>
    </div>
  </OPopover>
</template>

<script lang="ts">
import type { MentionOption } from "@/components/ai-assistant/context/AssistantMentionMenu.vue";

export interface AssistantAddContextMenuProps {
  org: string;
}

export interface AssistantAddContextMenuEmits {
  (e: "select", option: MentionOption): void;
  /** The Image row: the composer opens its file picker. */
  (e: "image"): void;
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantMentionMenu from "@/components/ai-assistant/context/AssistantMentionMenu.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped } from "@/types/i18n";

defineProps<AssistantAddContextMenuProps>();

const emit = defineEmits<AssistantAddContextMenuEmits>();

const { t } = useI18nTyped();
const open = ref(false);
const query = ref("");
const search = ref<InstanceType<typeof OInput> | null>(null);
const menu = ref<InstanceType<typeof AssistantMentionMenu> | null>(null);
const listboxId = `assistant-add-context-${useId()}`;

// The keys the retired hints popover listed, plus the `@` that opens this same menu from the textbox.
const keyRows = computed(() => [
  { id: "mention", label: t("assistant.composer.mention.title"), keys: raw("@") },
  {
    id: "assistantComposerRecall",
    label: t("shortcuts.actions.assistantComposerRecall"),
    shortcut: true,
  },
  {
    id: "assistantComposerNewline",
    label: t("shortcuts.actions.assistantComposerNewline"),
    shortcut: true,
  },
  {
    id: "assistantComposerSend",
    label: t("shortcuts.actions.assistantComposerSend"),
    shortcut: true,
  },
]);

const searchAttrs = computed(() => ({
  "aria-label": t("assistant.composer.addMenuSearch"),
  "aria-autocomplete": "list",
  "aria-controls": listboxId,
  "aria-activedescendant": menu.value?.activeId,
}));

function onOpen(value: boolean): void {
  open.value = value;
  query.value = "";
  if (!value) return;
  trackAssistant("ai_context_inspected", { target: "add_context" });
  void nextTick(() => search.value?.focus());
}

function close(): void {
  open.value = false;
  query.value = "";
}

function pick(option: MentionOption): void {
  close();
  if (option.action === "image") emit("image");
  else emit("select", option);
}

// The search keeps focus while ↑/↓ move the active row, as the `@` menu does from the textbox.
function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    menu.value?.move(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  const option = menu.value?.current();
  if (option) menu.value?.choose(option);
}

defineExpose({ close, isOpen: () => open.value });
</script>
