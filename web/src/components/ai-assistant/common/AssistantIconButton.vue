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
  <OButton
    :variant="on ? 'primary' : variant"
    :size="done ? 'xs' : ICON_SIZES[size]"
    :disabled="disabled"
    :loading="loading"
    :focusable-unavailable="unavailable"
    :aria-label="done ?? label"
    :aria-pressed="pressed"
    :data-test="dataTest"
    :data-size="size"
    :data-on="on || undefined"
    :data-done="done ? true : undefined"
    :class="[
      'max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11',
      chevron ? 'w-9! gap-0.5' : '',
      done ? 'text-status-success-text! ps-1.5 pe-2 font-medium' : '',
    ]"
    @click="emit('click', $event)"
  >
    <OIcon v-if="done" :name="assistantGlyph.done" size="sm" />
    <span v-else-if="badge" class="relative inline-flex">
      <OIcon :name="icon" size="sm" />
      <span
        aria-hidden="true"
        class="rounded-default bg-surface-base text-text-secondary absolute -end-1.5 -bottom-1 inline-flex"
      >
        <OIcon :name="badge" size="xs" />
      </span>
    </span>
    <OIcon v-else :name="icon" size="sm" />
    <!-- A live region mounted with its text is often not announced, so a confirming button keeps it mounted -->
    <span v-if="confirms || done" aria-live="polite" :class="done ? '' : 'sr-only'">{{
      done ?? ""
    }}</span>
    <OIcon v-if="chevron" :name="assistantGlyph.expand" size="xs" />
    <template v-if="unavailable" #unavailable-reason>{{ disabledReason }}</template>
    <!-- An open menu or popover covers what the tooltip would say, so the tooltip waits (D2) -->
    <OTooltip
      v-if="!noTooltip && !done"
      :disabled="$attrs['aria-expanded'] === true || $attrs['aria-expanded'] === 'true'"
      :content="$slots.tooltip && !unavailable ? undefined : tooltip"
      :shortcut-id="shortcutId"
    >
      <template v-if="$slots.tooltip && !unavailable" #content><slot name="tooltip" /></template>
    </OTooltip>
  </OButton>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

import { assistantGlyph } from "./glyphs";
import type {
  AssistantIconButtonEmits,
  AssistantIconButtonProps,
  AssistantIconButtonSlots,
} from "./AssistantIconButton.types";

const ICON_SIZES = { sm: "icon-xs-sq", toolbar: "icon-toolbar", md: "icon-sm" } as const;

const props = withDefaults(defineProps<AssistantIconButtonProps>(), {
  shortcutId: undefined,
  variant: "ghost",
  size: "sm",
  pressed: undefined,
  loading: false,
  disabled: false,
  disabledReason: undefined,
  badge: undefined,
  noTooltip: false,
  chevron: false,
  on: false,
  done: undefined,
  confirms: false,
});

const emit = defineEmits<AssistantIconButtonEmits>();

defineSlots<AssistantIconButtonSlots>();

// A disabled button with a reason stays focusable so keyboard and screen-reader users can reach why.
const unavailable = computed(() => props.disabled && !!props.disabledReason);
const tooltip = computed(() =>
  unavailable.value && props.disabledReason ? props.disabledReason : props.label,
);
</script>
