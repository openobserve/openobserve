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

<!-- One way to start in the starter menu: icon, name, one line on what it does, and where it leads. -->
<template>
  <button
    type="button"
    :aria-disabled="locked || undefined"
    :class="[
      'group rounded-default border-border-default bg-surface-base flex w-full min-w-0 items-center gap-3 border px-3 py-2.5 text-start transition-[background-color,border-color] duration-150 outline-none',
      'focus-visible:ring-accent/40 focus-visible:ring-2',
      locked
        ? 'cursor-not-allowed'
        : 'in-data-pointer-moved:hover:border-accent in-data-pointer-moved:hover:bg-tabs-hover-bg cursor-pointer',
    ]"
    @click="onClick"
  >
    <span
      :class="[
        'rounded-default inline-flex size-9 shrink-0 items-center justify-center',
        locked
          ? 'bg-section-header-bg text-text-disabled'
          : 'bg-tabs-active-bg text-tabs-active-text',
      ]"
    >
      <OIcon :name="locked ? 'lock' : icon" size="md" />
    </span>
    <span class="flex min-w-0 flex-1 flex-col">
      <span
        class="text-sm font-medium"
        :class="locked ? 'text-text-secondary' : 'text-text-heading'"
        >{{ label }}</span
      >
      <span class="text-text-secondary text-xs" data-test="create-starter-choice-row-description">{{
        locked ? lockedReason : description
      }}</span>
    </span>
    <span
      v-if="meta && !locked"
      class="text-text-secondary shrink-0 text-xs tabular-nums"
      data-test="create-starter-choice-row-meta"
      >{{ meta }}</span
    >
    <OIcon
      v-if="!locked"
      :name="affordance === 'go' ? 'arrow-forward' : 'chevron-right'"
      size="sm"
      class="text-text-secondary in-data-pointer-moved:group-hover:text-accent shrink-0"
    />
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    icon: IconName;
    label: I18nText;
    description: I18nText;
    /** Quiet text before the arrow, e.g. how many match. */
    meta?: I18nText | null;
    /** "open" opens a pane in place; "go" leaves for another screen. */
    affordance?: "open" | "go";
    /** Set when the choice is locked: shown in place of the description, and clicks do nothing. */
    lockedReason?: I18nText;
  }>(),
  { meta: null, affordance: "open", lockedReason: undefined },
);

const emit = defineEmits<{ click: [] }>();

const locked = computed(() => !!props.lockedReason);

const onClick = () => {
  if (!locked.value) emit("click");
};
</script>
