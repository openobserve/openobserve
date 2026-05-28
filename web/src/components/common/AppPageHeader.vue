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
  AppPageHeader — the standard, compact page header used across the app
  (dashboards, logs, metrics, …). One <h1> title with an optional brand-tinted
  page-icon tile, an optional subtitle/breadcrumb line, and a right-aligned
  actions area. Reusable as-is on dense data pages.

  Fixed height + items-center: the icon and title stay perfectly still even
  while the title/subtitle load asynchronously (no layout shift).

  NOTE: title/heading font sizes use `!important` because the app defines
  global, *unlayered* h1/h2 rules (styles/app.scss) that otherwise beat
  Tailwind utilities (unlayered CSS wins over layered utilities in v4).

  Props: title | subtitle | icon
  Slots: title-prefix | title | subtitle | actions
-->
<template>
  <!-- No overflow-hidden here: it clipped the focus ring of the right-most
       action button. Title overflow is handled by truncate + min-w-0 on the
       title block instead. h-14 gives the header a touch more breathing room. -->
  <header
    class="app-page-header tw:shrink-0 tw:h-14 tw:flex tw:items-center tw:justify-between tw:gap-4"
  >
    <div class="tw:flex tw:items-center tw:gap-3 tw:min-w-0 tw:h-full">
      <slot name="title-prefix" />

      <span
        v-if="icon"
        class="tw:inline-flex tw:items-center tw:justify-center tw:shrink-0 tw:w-8 tw:h-8 tw:rounded-lg tw:bg-tabs-active-bg tw:text-tabs-active-text"
        aria-hidden="true"
      >
        <OIcon :name="icon" size="md" />
      </span>

      <div class="tw:flex tw:flex-col tw:justify-center tw:min-w-0">
        <h1
          class="tw:text-base! tw:font-semibold! tw:leading-tight! tw:tracking-[-0.01em]! tw:text-text-primary tw:truncate tw:min-h-5"
          :title="title"
        >
          <slot name="title">{{ title }}</slot>
        </h1>
        <!-- Fixed-height subtitle band: keeps the <h1> at an identical Y whether
             the subtitle is plain text (listing) or a taller breadcrumb nav
             (detail view), so the title doesn't appear to shift when navigating
             between the two. Content is vertically centered within the band. -->
        <div
          v-if="subtitle || $slots.subtitle"
          class="tw:flex tw:items-center tw:h-5 tw:min-w-0 tw:text-xs tw:text-text-secondary"
        >
          <slot name="subtitle"
            ><span class="tw:truncate tw:min-w-0">{{ subtitle }}</span></slot
          >
        </div>
      </div>
    </div>

    <div
      v-if="$slots.actions"
      class="tw:flex tw:items-center tw:gap-2 tw:shrink-0"
    >
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

withDefaults(
  defineProps<{
    title?: string;
    subtitle?: string;
    icon?: IconName;
  }>(),
  {
    title: "",
    subtitle: "",
  },
);
</script>
