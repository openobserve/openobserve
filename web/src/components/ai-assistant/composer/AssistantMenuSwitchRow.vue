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
  <ODropdownItem
    role="menuitemcheckbox"
    :aria-checked="checked"
    :disabled="disabled"
    focusable-unavailable
    :text-value="label"
    class="min-h-8"
    @select="toggle"
  >
    <slot name="icon-left" />
    <span class="flex min-w-0 flex-1 flex-col items-start text-start">
      <span class="flex min-w-0 items-center gap-1.5 text-sm">
        <span class="truncate">{{ label }}</span>
        <slot name="badge" />
      </span>
      <span v-if="hint" class="text-text-secondary min-w-0 truncate text-xs">{{ hint }}</span>
    </span>
    <template #icon-right>
      <!-- The row is the control; this track only shows its state -->
      <span
        aria-hidden="true"
        :class="[
          'ms-auto inline-flex h-4.5 w-7 shrink-0 items-center rounded-full border-2 p-0.5',
          checked ? 'bg-switch-track-on border-switch-border' : 'border-switch-border-off',
          disabled ? 'opacity-45' : '',
        ]"
      >
        <span
          :class="[
            'block size-2.5 rounded-full motion-safe:transition-transform',
            checked ? 'translate-x-2.5 bg-white rtl:-translate-x-2.5' : 'bg-switch-thumb-off',
          ]"
        />
      </span>
    </template>
  </ODropdownItem>
</template>

<script setup lang="ts">
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import type { I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    label: I18nText;
    checked: boolean;
    hint?: string;
    disabled?: boolean;
  }>(),
  { hint: undefined, disabled: false },
);

const emit = defineEmits<{ (e: "toggle", value: boolean): void }>();

defineSlots<{ "icon-left"?: () => unknown; badge?: () => unknown }>();

// The menu stays open, so the user sees the switch flip.
function toggle(event: Event): void {
  event.preventDefault();
  if (!props.disabled) emit("toggle", !props.checked);
}
</script>
