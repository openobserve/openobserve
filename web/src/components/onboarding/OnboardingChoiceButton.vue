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

<!-- One onboarding option: a full-width row button, or a quieter tile with `quiet`.
     `previewed` marks the option the side panel shows: it takes the panel's brand fill, so the two
     read as a pair. Phones have no panel, so no fill there. Up and down arrows move between the
     rows of one list. -->
<template>
  <button
    type="button"
    :class="[
      'group rounded-default focus-visible:ring-focus-ring-accent focus-visible:ring-offset-surface-base flex w-full min-w-0 border text-start transition-[background-color,border-color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none',
      quiet ? 'items-start gap-2.5 px-3 py-2.5' : 'items-center gap-3 px-4 py-2.5',
      previewed ? ACTIVE[quiet ? 'quiet' : 'row'] : IDLE[quiet ? 'quiet' : 'row'],
    ]"
    :data-onboarding-row="quiet ? undefined : ''"
    @keydown="onKeydown"
  >
    <OIcon
      v-if="quiet"
      :name="icon"
      size="sm"
      :class="[
        'mt-0.5 shrink-0',
        previewed ? 'text-text-secondary md:text-onboarding-panel-text' : 'text-text-secondary',
      ]"
    />
    <!-- A source's own logo, as on the Data sources page, on a plain chip so dark logos stay visible. -->
    <span
      v-else-if="logo"
      class="rounded-default border-border-subtle bg-surface-subtle inline-flex size-8 shrink-0 items-center justify-center border"
    >
      <img :src="logoSrc" alt="" class="size-5 object-contain" />
    </span>
    <span
      v-else
      :class="[
        'rounded-default inline-flex size-8 shrink-0 items-center justify-center',
        previewed
          ? 'bg-icon-chip-primary-bg text-icon-chip-primary-text md:bg-onboarding-panel-text/18 md:text-onboarding-panel-text'
          : 'bg-icon-chip-primary-bg text-icon-chip-primary-text group-hover:bg-surface-base',
      ]"
    >
      <OIcon :name="icon" size="sm" />
    </span>
    <span class="grid min-w-0 flex-1 gap-0.5">
      <span
        :class="[
          quiet ? 'text-compact font-medium' : 'text-sm font-semibold',
          previewed ? 'text-text-heading md:text-onboarding-panel-text' : 'text-text-heading',
        ]"
        >{{ name }}</span
      >
      <span
        v-if="description"
        :class="[
          quiet ? 'text-xs' : 'text-compact',
          previewed
            ? 'text-text-secondary md:text-onboarding-panel-text/85'
            : 'text-text-secondary',
        ]"
        >{{ description }}</span
      >
    </span>
    <OIcon
      v-if="!quiet"
      name="arrow-forward"
      size="sm"
      :class="[
        'shrink-0 transition-transform group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5 motion-reduce:transition-none',
        previewed
          ? 'text-text-secondary md:text-onboarding-panel-text md:translate-x-0.5'
          : 'text-text-secondary group-hover:text-text-heading',
      ]"
    />
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import type { I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";

const props = defineProps<{
  icon: IconName;
  name: I18nText;
  description?: I18nText;
  /** A logo that replaces the icon, as for a guide tile: a path under `assets/`, or a full URL. */
  logo?: string;
  /** The option the side panel shows. */
  previewed?: boolean;
  /** The quieter tile used for "Other ways to start". */
  quiet?: boolean;
}>();

// A catalog URL is used as is; a bare path resolves under `assets/`.
const logoSrc = computed(() =>
  props.logo && /^(https?:|\/|data:)/.test(props.logo) ? props.logo : getImageURL(props.logo ?? ""),
);

const IDLE = {
  row: "border-border-default bg-surface-base hover:border-accent hover:bg-surface-accent-hover",
  quiet: "bg-surface-panel hover:border-border-default border-transparent",
};
// The brand fill from the tablet width up; below it, the idle look.
const ACTIVE = {
  row: "max-md:border-border-default max-md:bg-surface-base max-md:hover:border-accent max-md:hover:bg-surface-accent-hover md:bg-onboarding-choice-active-bg md:border-transparent md:shadow-md",
  quiet:
    "max-md:bg-surface-panel max-md:hover:border-border-default max-md:border-transparent md:bg-onboarding-choice-active-bg md:border-transparent md:shadow-md",
};

// Up and down move focus to the previous or next row in the same list, wrapping at the ends.
const onKeydown = (e: KeyboardEvent) => {
  const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  if (props.quiet || !step) return;
  const row = e.currentTarget as HTMLElement;
  const rows = Array.from(
    row.closest("ul")?.querySelectorAll<HTMLElement>("[data-onboarding-row]") ?? [],
  );
  if (rows.length < 2) return;
  e.preventDefault();
  rows[(rows.indexOf(row) + step + rows.length) % rows.length].focus();
};
</script>
