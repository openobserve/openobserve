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
  <div
    class="grid min-h-10 grid-cols-[7rem_minmax(0,1fr)_6.5rem_8rem] items-center gap-x-3 gap-y-1 py-1 max-md:grid-cols-[minmax(0,1fr)_auto_auto]"
    :data-test="dataTest"
  >
    <span class="flex min-w-0 items-center gap-2">
      <img v-if="iconSrc" :src="iconSrc" alt="" class="size-4 shrink-0" />
      <OIcon v-else-if="icon" :name="icon" size="sm" class="text-text-secondary shrink-0" />
      <OText variant="body" as="span">{{ label }}</OText>
    </span>
    <span class="flex min-w-0 items-center gap-1 max-md:col-span-3 max-md:row-start-2">
      <slot name="value" />
    </span>
    <span class="flex min-w-0 items-center">
      <slot name="status" />
    </span>
    <span class="flex items-center justify-end gap-1">
      <slot name="action" />
    </span>
  </div>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import OText from "@/lib/core/Typography/OText.vue";
import type { I18nText } from "@/types/i18n";

defineProps<{
  label: I18nText;
  icon?: IconName;
  /** An image in place of the icon, for a brand mark such as Slack's. */
  iconSrc?: string;
  dataTest?: string;
}>();
</script>
