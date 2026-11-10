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
<!-- Reuses the PanelContainer bar styling without its editable-grid machinery. -->
<template>
  <div
    class="bg-card-glass-bg rounded-default border-border-default flex flex-col overflow-hidden border"
  >
    <div
      class="border-border-default rounded-t-default flex min-h-7 w-full flex-nowrap items-center gap-2 border-b px-2 py-1"
    >
      <div class="flex min-w-0 items-baseline gap-2">
        <span class="text-compact text-text-heading shrink-0 font-medium tracking-[0.02em]">
          {{ title }}
        </span>
        <OTruncatedText v-if="subtitle" class="text-text-secondary text-2xs leading-normal">
          {{ subtitle }}
        </OTruncatedText>
      </div>
      <div class="flex-1" />
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-1">
        <slot name="actions" />
      </div>
    </div>

    <div class="min-h-0 flex-1">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";

defineProps<{
  /** Resolved panel title (the caller passes its own t(...) value). */
  title: I18nText;
  /** Optional resolved subtitle, shown muted inline after the title. */
  subtitle?: I18nText;
}>();
</script>
