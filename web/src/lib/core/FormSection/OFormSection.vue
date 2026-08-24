<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  One titled section of a long form — the bordered card with an accent-marked
  header that the Add Alert page established.

  It exists because that shape was hand-assembled from the same six utility
  classes in five different places (`AddAlert.vue`, and `steps/QueryConfig`,
  `CompareWithPast`, `Deduplication`, `Advanced`, `AlertSettings`), which is
  five chances for one of them to drift. The accent bar's width, the header's
  padding and the body's padding are decisions that should be made once.

  The card is `bg-surface-overlay` (white) with a border, NOT `bg-card-bg`:
  a form section has to read as a container sitting ON the page. `bg-card-bg`
  resolves to `--color-grey-50`, close enough to the page behind it that the
  section boundary disappears and the fields run together — which is exactly
  what the borderless version looked like.

  Use it for any multi-section form. For a page's own content inset use
  `OContent`; this is a container, not an inset.
-->
<template>
  <div
    class="rounded-default bg-surface-overlay border-border-default border"
    :data-test="dataTest"
  >
    <div class="border-border-default flex items-center gap-2 border-b px-3 py-2.5">
      <!-- The accent bar. A 3px rule rather than an icon: it marks the header
           as a section boundary without competing with the controls below. -->
      <div class="rounded-default bg-theme-accent h-4 w-0.75 shrink-0" />
      <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
        {{ title }}<span v-if="required" class="text-text-body"> *</span>
      </span>
      <div v-if="$slots.actions" class="ml-auto flex items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <div class="px-3 py-2">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";

defineProps<{
  title: I18nText;
  /** Appends the required marker to the heading. */
  required?: boolean;
  dataTest?: string;
}>();
</script>
