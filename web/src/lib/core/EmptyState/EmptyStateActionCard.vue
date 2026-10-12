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

<!--
  EmptyStateActionCard — an actionable next-step card for empty states: icon +
  title + description, lifting on hover with a sliding chevron. Every card shares
  one look so options read as equal, clearly-clickable actions. Tailwind-only,
  token-based. (Self-contained copy for the EmptyState lib.)
-->
<template>
  <button
    type="button"
    :aria-disabled="unavailable || undefined"
    @click="handleClick"
    :class="[
      'group rounded-default border-border-default bg-surface-base focus-visible:ring-accent/40 relative flex min-h-16 min-w-0 flex-1 basis-56 items-center border py-2.5 ps-3 pe-3.5 text-left transition-[color,background-color,border-color,box-shadow,transform] duration-150 outline-none focus-visible:ring-[0.125rem] max-md:min-h-0 max-md:basis-full max-md:py-2',
      size === 'compact' ? 'max-w-80 gap-2 max-md:max-w-80' : 'max-w-72 gap-3 max-md:max-w-full',
      unavailable
        ? 'cursor-not-allowed'
        : 'hover:border-accent hover:bg-tabs-hover-bg cursor-pointer hover:shadow-md',
    ]"
  >
    <span
      :class="[
        'rounded-default relative inline-flex shrink-0 items-center justify-center transition-colors max-md:size-8',
        size === 'compact' ? 'size-8' : 'size-10',
        unavailable
          ? 'bg-section-header-bg text-text-disabled'
          : 'bg-tabs-active-bg text-tabs-active-text group-hover:bg-accent group-hover:text-text-inverse',
      ]"
    >
      <OIcon :name="icon" size="md" />
    </span>

    <span class="relative min-w-0 flex-1">
      <span
        :title="$slots.label ? undefined : label"
        :class="[
          'block text-sm font-medium wrap-break-word',
          unavailable ? 'text-text-disabled' : 'text-text-heading',
          size === 'compact' && 'md:whitespace-nowrap',
        ]"
        ><slot name="label">{{ label }}</slot></span
      >
      <span v-if="sublabel" class="text-text-secondary block text-xs leading-snug">{{
        sublabel
      }}</span>
    </span>

    <OIcon
      v-if="!hideChevron"
      name="chevron-right"
      size="sm"
      class="text-text-disabled group-hover:text-accent relative shrink-0 transition-transform group-hover:translate-x-0.5"
    />
  </button>
</template>

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

const props = withDefaults(
  defineProps<{
    icon: IconName | (string & {});
    label: I18nText;
    sublabel?: I18nText;
    hideChevron?: boolean;
    /** Fits action choices in a compact empty state. */
    size?: "default" | "compact";
    /** Keeps the reason focusable while preventing the unavailable action. */
    unavailable?: boolean;
  }>(),
  { size: "default", unavailable: false },
);

const emit = defineEmits<{ click: [event: MouseEvent] }>();
const handleClick = (event: MouseEvent) => {
  if (props.unavailable) {
    event.preventDefault();
    return;
  }
  emit("click", event);
};
</script>
