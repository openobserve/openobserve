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

<template>
  <section v-if="stacked" class="flex flex-col gap-1.5" :data-test="testId">
    <div class="flex min-h-6 items-center gap-1">
      <span class="text-text-secondary min-w-0 text-xs font-semibold">{{ title }}</span>
      <span
        v-if="caption"
        tabindex="0"
        role="img"
        :aria-label="caption"
        class="text-text-secondary flex items-center"
      >
        <OIcon name="info-outline" size="xs" />
        <OTooltip :content="caption" />
      </span>
      <span class="ms-auto flex items-center gap-1"><slot name="action" /></span>
    </div>
    <div
      v-if="boxed"
      class="border-border-default rounded-default flex flex-wrap items-center gap-1.5 border px-2 py-1.5 text-xs"
    >
      <slot />
    </div>
    <slot name="body" />
    <div v-if="$slots.trailing" class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <slot name="trailing" />
    </div>
  </section>
  <section v-else class="flex flex-col gap-1" :data-test="testId">
    <div class="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1.5 px-2">
      <span class="text-text-heading text-sm font-semibold">{{ title }}</span>
      <slot />
      <slot name="action" />
      <span v-if="caption" class="text-text-secondary text-xs">{{ caption }}</span>
      <span v-if="$slots.trailing" class="ms-auto flex flex-wrap items-center gap-x-1.5">
        <slot name="trailing" />
      </span>
    </div>
    <slot name="body" />
  </section>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { I18nText } from "@/types/i18n";

defineOptions({ name: "FunnelSectionRow" });

defineProps<{
  title: I18nText;
  caption?: I18nText;
  stacked?: boolean;
  boxed?: boolean;
  testId: string;
}>();
</script>
