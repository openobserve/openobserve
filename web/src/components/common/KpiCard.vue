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
  KpiCard — the stat tile used in every KPI strip (Quality, LLM Insights, eval
  job/scorer detail, RUM). It owns the CHROME that kept drifting — padding,
  radius, border, hover elevation, the label/icon row and their typography —
  while each screen supplies its own value/trend/footer content through slots.

  Why this exists: the same tile was hand-rolled in eight places with four card
  paddings, four different hover shadows (two of them hardcoded px + rgba), and
  two competing label typography systems. See SPACING_AUDIT.md §7.

  Slots: label | icon | value | trend | footer (sparkline etc.)
  Props: label, icon, as, dataTest
-->
<template>
  <component
    :is="as"
    class="bg-card-glass-bg rounded-default flex flex-col px-3.5 py-2.5 gap-1 border border-border-default transition-shadow duration-200 ease-in-out hover:shadow-md"
    :data-test="dataTest"
  >
    <div class="flex items-center justify-between gap-2 mb-1">
      <div
        class="min-w-0 truncate"
        :class="labelClass || 'text-2xs font-semibold leading-normal text-text-secondary'"
      >
        <slot name="label">{{ label }}</slot>
      </div>
      <span
        v-if="icon || $slots.icon"
        class="inline-flex items-center justify-center shrink-0 rounded-default"
        :class="[
          iconSize === 'md' ? 'w-10 h-10' : 'w-6 h-6',
          iconClass || 'bg-surface-subtle text-text-secondary',
        ]"
      >
        <slot name="icon">
          <OIcon v-if="icon" :name="icon" :size="iconSize" />
        </slot>
      </span>
    </div>

    <div v-if="$slots.value" class="flex items-baseline gap-1">
      <slot name="value" />
    </div>

    <div
      v-if="$slots.trend"
      class="text-3xs font-medium flex items-center gap-1"
    >
      <slot name="trend" />
    </div>

    <slot name="footer" />
  </component>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

withDefaults(
  defineProps<{
    label?: string;
    /** Override the label's typography classes. Omit for the compact default. */
    labelClass?: string;
    icon?: IconName;
    /**
     * Override the icon badge's color classes (bg + text). Omit for the default
     * monochrome subtle badge. Use token-backed utilities, e.g.
     * `bg-(--color-indigo-50) text-(--color-indigo-600) dark:…`.
     */
    iconClass?: string;
    /** Icon badge size. `md` renders the larger, more prominent colored tile. */
    iconSize?: "sm" | "md";
    /** Element to render as — `button` when the tile is selectable. */
    as?: string;
    dataTest?: string;
  }>(),
  {
    label: "",
    labelClass: undefined,
    icon: undefined,
    iconClass: undefined,
    iconSize: "sm",
    as: "div",
    dataTest: undefined,
  },
);
</script>
