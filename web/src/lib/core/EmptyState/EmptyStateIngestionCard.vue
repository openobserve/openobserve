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
  EmptyStateIngestionCard — shared action card used across ingestion / onboarding
  empty states (LogsNoDataState, TracesNoDataState, HomeNoDataState, etc.).
  Consolidates the repeated .nd-card / .ns-card / .tnd-card / .hnd-card CSS.
-->
<template>
  <button
    type="button"
    class="es-ing-card group rounded-default border-border-default bg-surface-base hover:border-accent hover:bg-tabs-hover-bg focus-visible:ring-accent/40 relative flex min-h-16 max-w-72 min-w-0 flex-1 basis-56 cursor-pointer items-center gap-3 border py-2.5 pr-3.5 pl-3 text-left transition-[color,background-color,border-color,box-shadow] duration-150 outline-none hover:shadow-md focus-visible:ring-2"
    @click="emit('click')"
  >
    <span
      class="es-ing-card__icon rounded-default group-hover:bg-button-primary inline-flex h-10 w-10 shrink-0 items-center justify-center transition-[background-color,color] duration-150 group-hover:text-white"
      :class="iconClass"
    >
      <OIcon :name="icon" size="md" />
    </span>
    <span class="es-ing-card__body flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="text-compact text-text-heading truncate font-semibold">{{ label }}</span>
      <span v-if="sublabel" class="text-text-secondary text-xs leading-[1.4]">{{ sublabel }}</span>
    </span>
    <OIcon
      name="chevron-right"
      size="sm"
      class="es-ing-card__chevron text-text-disabled group-hover:text-accent shrink-0 transition-[transform,color] duration-150 group-hover:translate-x-0.5"
    />
  </button>
</template>

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

type IconVariant = "default" | "blue" | "teal" | "purple" | "amber" | "orange";

const props = withDefaults(
  defineProps<{
    icon: IconName;
    label: I18nText;
    sublabel?: I18nText;
    iconVariant?: IconVariant;
  }>(),
  { iconVariant: "default" },
);

const emit = defineEmits<{ click: [] }>();

// Each variant carries BOTH its resting background and its resting colour. They
// are not split between here and the base class on purpose: two plain utilities
// setting the same property differ only by Tailwind's emit order, so
// `text-tabs-active-text` in the base class silently won over every
// `text-ingest-accent-*` and all five variants rendered one colour.
const ICON_VARIANT_CLASS: Record<IconVariant, string> = {
  default: "bg-tabs-active-bg text-tabs-active-text",
  blue: "bg-ingest-tint-blue text-ingest-accent-blue",
  teal: "bg-ingest-tint-teal text-ingest-accent-teal",
  purple: "bg-ingest-tint-purple text-ingest-accent-purple",
  amber: "bg-ingest-tint-amber text-ingest-accent-amber",
  orange: "bg-ingest-tint-orange text-ingest-accent-orange",
};

const iconClass = computed(() => ICON_VARIANT_CLASS[props.iconVariant]);
</script>
