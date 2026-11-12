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

<!-- The last row drops its own rule, so a card needs no per-row conditionals. -->
<template>
  <div
    class="flex gap-6 max-md:flex-col max-md:items-stretch max-md:gap-2"
    :class="[
      fill ? 'items-start' : 'items-center',
      !inPair && !bare && 'border-border-default border-b px-3 py-3 last:border-b-0',
      !inPair && bare && 'py-2',
      disabled && 'opacity-60',
    ]"
    :data-test="dataTest"
  >
    <!-- Half of a 45% pair cell, so single and paired controls share one column. -->
    <div
      class="min-w-0 shrink-0 max-md:w-full max-md:pt-0"
      :class="[inPair ? 'w-1/2' : 'w-[22.5%]', fill && 'pt-2']"
    >
      <div class="text-text-heading flex items-center gap-1 text-sm font-medium">
        <span
          >{{ label }}<span v-if="required" class="text-text-body">{{ requiredMark }}</span></span
        >
        <span
          v-if="info"
          tabindex="0"
          role="img"
          class="text-text-secondary flex items-center"
          :aria-label="info"
          :data-test="dataTest ? `${dataTest}-info` : undefined"
        >
          <OIcon name="info-outline" size="xs" />
          <OTooltip :content="info" />
        </span>
      </div>
      <div v-if="description" class="text-text-secondary mt-0.5 text-xs">
        {{ description }}
      </div>
    </div>
    <div v-if="fill" class="min-w-0 flex-1 max-md:w-full">
      <slot />
    </div>
    <div v-else class="flex shrink-0 items-center justify-end max-md:min-w-0 max-md:justify-start">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";

import {
  SETTING_ROW_BARE_KEY,
  SETTING_ROW_PAIR_KEY,
  type SettingRowProps,
} from "./OSettingRow.types";

defineProps<SettingRowProps>();

const inPair = inject(SETTING_ROW_PAIR_KEY, false);
const bare = inject(SETTING_ROW_BARE_KEY, false);
const requiredMark = raw(" *");
</script>
