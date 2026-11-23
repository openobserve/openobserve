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
    v-if="isPlain"
    class="rounded-surface bg-surface-overlay border"
    :class="isDanger ? 'border-button-ghost-destructive-text' : 'border-border-default'"
    :data-test="dataTest"
  >
    <div
      class="rounded-t-surface bg-surface-subtle border-border-default flex items-center gap-3 border-b px-4 py-3"
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <OIcon v-if="isDanger" name="warning" size="sm" class="text-status-error-text shrink-0" />
          <h2
            class="text-base font-semibold"
            :class="isDanger ? 'text-status-error-text' : 'text-text-heading'"
          >
            {{ title }}<span v-if="required" class="text-text-body"> *</span>
          </h2>
          <span
            v-if="info"
            tabindex="0"
            role="img"
            class="text-text-secondary -ms-1 flex items-center"
            :aria-label="info"
            :data-test="dataTest ? `${dataTest}-info` : undefined"
          >
            <OIcon name="info-outline" size="xs" />
            <OTooltip :content="info" />
          </span>
        </div>
        <p
          v-if="description || $slots.description"
          class="text-text-secondary text-compact mt-0.5"
          :data-test="dataTest ? `${dataTest}-description` : undefined"
        >
          <slot name="description">{{ description }}</slot>
        </p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <!-- Rows carry the inset so their rules reach the card edge; other content keeps the body's. -->
    <div class="px-4 py-3 has-[[data-o-setting-row]]:p-0 [&_[data-o-setting-row]]:px-4">
      <slot />
    </div>
  </div>
  <div
    v-else
    class="rounded-default bg-surface-overlay border-border-default border"
    :data-test="dataTest"
  >
    <div class="border-border-default border-b px-3 py-2.5">
      <div class="flex items-center gap-2">
        <!-- The accent bar. A 3px rule rather than an icon: it marks the header
             as a section boundary without competing with the controls below. -->
        <div class="rounded-default bg-theme-accent h-4 w-0.75 shrink-0" />
        <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
          {{ title }}<span v-if="required" class="text-text-body"> *</span>
        </span>
        <span
          v-if="info"
          tabindex="0"
          role="img"
          class="text-text-secondary -ms-1 flex items-center"
          :aria-label="info"
          :data-test="dataTest ? `${dataTest}-info` : undefined"
        >
          <OIcon name="info-outline" size="xs" />
          <OTooltip :content="info" />
        </span>
        <div v-if="$slots.actions" class="ms-auto flex items-center gap-2">
          <slot name="actions" />
        </div>
      </div>
      <p
        v-if="description || $slots.description"
        class="text-text-secondary mt-0.5 text-xs"
        :data-test="dataTest ? `${dataTest}-description` : undefined"
      >
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div class="px-3 py-2">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    title: I18nText;
    /** Explains the section in a tooltip on an info icon after the heading. */
    info?: I18nText;
    /** Appends the required marker to the heading. */
    required?: boolean;
    /** `plain` puts an `h2` heading in a header band and lets setting rows run edge to edge. */
    variant?: "accent" | "plain";
    /** One line under the heading. */
    description?: I18nText;
    /** `danger` marks a destructive section; it applies to the plain variant only. */
    tone?: "default" | "danger";
    dataTest?: string;
  }>(),
  { variant: "accent", tone: "default" },
);

const isPlain = computed(() => props.variant === "plain");
const isDanger = computed(() => isPlain.value && props.tone === "danger");
</script>
