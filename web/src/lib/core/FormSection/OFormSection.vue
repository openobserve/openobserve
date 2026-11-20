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

<!-- `plain` is an unboxed title over its rows, so a section never outweighs the page title (T1, T2).
     `accent` keeps the bordered card the Add alert steps share. -->
<template>
  <section v-if="isPlain" class="flex flex-col" :data-test="dataTest">
    <div
      class="flex items-center gap-3 border-b pb-2"
      :class="isDanger ? 'border-button-ghost-destructive-text' : 'border-border-default'"
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <OIcon v-if="isDanger" name="warning" size="sm" class="text-status-error-text shrink-0" />
          <h2
            class="text-sm font-semibold"
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
    <!-- Row rules are a step lighter than the heading's, so the section edge stays the stronger line. -->
    <div
      class="[&_[data-o-setting-row]]:border-border-subtle pt-3 has-[[data-o-setting-row]]:pt-0 [&_[data-o-setting-row]]:px-0"
    >
      <slot />
    </div>
  </section>
  <div
    v-else
    class="rounded-default bg-surface-overlay border-border-default border"
    :data-test="dataTest"
  >
    <div class="border-border-default border-b px-3 py-2.5">
      <div class="flex items-center gap-2">
        <span class="text-text-heading text-sm font-semibold">
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
        class="text-text-secondary text-compact mt-0.5"
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
    /** `plain` is an unboxed `h2` over a hairline, with setting rows aligned to the heading. */
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
