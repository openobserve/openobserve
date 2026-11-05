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
  <span
    class="inline-flex max-w-full min-w-0 items-center"
    :data-test="`assistant-context-chip-${chip.kind}`"
    :data-state="state"
    data-assistant-chip
  >
    <OTag
      type="assistantContext"
      :value="state"
      :label="label"
      :icon="chipGlyph[chip.kind]"
      :clickable="!inert"
      :removable="removable"
      :remove-label="t('assistant.context.remove', { label })"
      remove-data-test="assistant-context-chip-remove"
      :role="removable ? 'button' : undefined"
      :aria-label="name"
      :aria-haspopup="popup && !inert ? 'dialog' : undefined"
      :aria-expanded="popup && !inert ? expanded : undefined"
      class="max-w-full min-w-0 motion-safe:transition-colors max-md:min-h-11 pointer-coarse:min-h-11 [&>button]:-my-0.5"
      data-test="assistant-context-chip-button"
      @click="onClick"
      @keydown="onKeydown"
      @remove="emit('remove')"
    >
      <template v-if="imageSrc" #icon>
        <img
          :src="imageSrc"
          alt=""
          class="rounded-default -my-0.5 size-4 shrink-0 object-cover"
          data-test="assistant-context-chip-thumb"
        />
      </template>
      <OTruncatedText class="min-w-0">{{ compact ? (shortLabel ?? label) : label }}</OTruncatedText>
      <span v-if="secondary && !compact" class="shrink-0 font-normal" aria-hidden="true"
        >{{ dot }} {{ secondary }}</span
      >
    </OTag>
  </span>
</template>

<script lang="ts">
import type { ChipState, ContextChip } from "@/composables/assistant";
import type { I18nText } from "@/types/i18n";

export interface AssistantContextChipProps {
  chip: ContextChip;
  /** Overrides the state the chip would derive, e.g. `ghost` for an "Add back" chip. */
  state?: ChipState;
  /** User messages and the turn footer: no remove, no keyboard removal. */
  readonly?: boolean;
  /** Non-interactive (a share, a disabled surface). */
  inert?: boolean;
  /** In the control row: the secondary goes to the name only, so the chip fits one line. */
  compact?: boolean;
  /** Compact text only (the range, the stream name); the icon says the kind and the name keeps the full label (CT-01 AC 9). */
  shortLabel?: I18nText;
  /** The chip opens a popover (the inspector, the time picker or the sees list); `false` for Add back. */
  popup?: boolean;
  expanded?: boolean;
  /** An image chip's data URL, shown as a thumbnail in place of the kind icon. */
  imageSrc?: string;
}

export interface AssistantContextChipEmits {
  (e: "open", event: MouseEvent | KeyboardEvent): void;
  (e: "remove"): void;
  (e: "move", direction: -1 | 1): void;
}
</script>

<script setup lang="ts">
import { computed } from "vue";

import { chipGlyph } from "@/components/ai-assistant/common/glyphs";
import { chipSecondaryOf, chipStateOf } from "@/composables/assistant";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantContextChipProps>(), {
  state: undefined,
  readonly: false,
  inert: false,
  compact: false,
  shortLabel: undefined,
  popup: true,
  expanded: false,
  imageSrc: undefined,
});

const emit = defineEmits<AssistantContextChipEmits>();

const { t } = useI18nTyped();
const dot = raw("·");

const state = computed<ChipState>(() => props.state ?? chipStateOf(props.chip));
const label = computed(() =>
  state.value === "ghost"
    ? t("assistant.context.addBack", { label: props.chip.label })
    : props.chip.label,
);
const secondary = computed(() =>
  state.value === "ghost" ? undefined : chipSecondaryOf(props.chip, t),
);
const name = computed(() =>
  secondary.value
    ? t("assistant.context.chipName", { label: label.value, secondary: secondary.value })
    : label.value,
);
const removable = computed(
  () => !props.readonly && !props.inert && state.value !== "ghost" && props.chip.kind !== "time",
);

function onClick(event: MouseEvent | KeyboardEvent): void {
  emit("open", event);
}

// Delete and Backspace remove a focused chip; the arrows hand focus to the neighbour (CT-08 AC 4, CT-01 AC 11).
function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (isRemoveActivation(event)) {
    // Runs before the badge's own Enter/Space handler, which would open the chip instead.
    event.preventDefault();
    event.stopImmediatePropagation();
    emit("remove");
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    emit("move", event.key === "ArrowLeft" ? -1 : 1);
  } else if ((event.key === "Delete" || event.key === "Backspace") && removable.value) {
    event.preventDefault();
    emit("remove");
  }
}

function isRemoveActivation(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return (
    (event.key === "Enter" || event.key === " ") &&
    target?.dataset.test === "assistant-context-chip-remove"
  );
}
</script>
