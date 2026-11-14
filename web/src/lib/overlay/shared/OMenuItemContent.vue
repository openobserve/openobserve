<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import type { I18nText } from "@/types/i18n";
import type { MenuItemProps } from "@/lib/overlay/Dropdown/ODropdownItem.types";

defineProps<
  Pick<MenuItemProps, "icon" | "tone" | "checked" | "shortcut" | "keys"> & {
    /** The line under the label: the disabled reason while disabled, else the description. */
    note?: I18nText | null;
    noteId?: string;
    muted?: boolean;
  }
>();
defineSlots<{ icon?: () => unknown; default?: () => unknown; end?: () => unknown }>();
</script>

<template>
  <span
    v-if="$slots.icon || icon"
    :class="[
      'flex shrink-0 items-center',
      note && 'self-start pt-0.5',
      muted ? 'text-dropdown-item-disabled' : tone === 'danger' ? '' : 'text-text-muted',
    ]"
  >
    <slot name="icon">
      <OIcon
        v-if="icon"
        :name="icon"
        size="sm"
        :class="icon === 'lock' ? 'lock-chip' : undefined"
      />
    </slot>
  </span>
  <span v-if="note" class="flex min-w-0 flex-1 flex-col">
    <span class="truncate"><slot /></span>
    <span
      :id="noteId"
      :data-test="noteId"
      aria-hidden="true"
      class="text-text-muted text-2xs leading-snug whitespace-normal"
      >{{ note }}</span
    >
  </span>
  <span v-else class="min-w-0 flex-1 truncate"><slot /></span>
  <slot name="end" />
  <OShortcut v-if="shortcut || keys" :keys="keys" :id="shortcut" class="ms-auto ps-3" />
  <OIcon v-if="checked" name="check" size="sm" class="text-accent ms-auto shrink-0" />
</template>
