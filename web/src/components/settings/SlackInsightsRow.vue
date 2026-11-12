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

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";

defineProps<{ label: I18nText; help: I18nText }>();
</script>

<template>
  <div
    class="border-border-default grid grid-cols-[1fr_20rem] gap-6 border-b p-4 max-md:grid-cols-1 max-md:gap-2.5"
  >
    <div class="flex min-w-0 flex-col">
      <div class="text-text-heading text-sm font-medium">{{ label }}</div>
      <div class="text-text-secondary text-compact mt-0.5">{{ help }}</div>
      <slot name="line" />
    </div>
    <div class="flex min-w-0 flex-col items-start gap-1.5">
      <slot />
    </div>
  </div>
</template>
