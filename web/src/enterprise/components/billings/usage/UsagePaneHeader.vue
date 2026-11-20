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

<!-- The 40 px panel header of a usage pane; a fixed height so drilling in never moves the content below. -->
<template>
  <div
    class="border-border-subtle flex h-10 w-full shrink-0 flex-nowrap items-center gap-2 border-b ps-3 pe-1.5"
  >
    <slot name="leading" />
    <div class="flex min-w-0 items-baseline gap-2">
      <span class="text-compact text-text-heading shrink-0 font-semibold">
        {{ title }}
      </span>
      <span v-if="subtitle" class="text-text-muted truncate text-xs">
        {{ subtitle }}
      </span>
    </div>
    <div v-if="$slots.actions" class="ms-auto flex shrink-0 items-center gap-1.5">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";

defineProps<{ title: I18nText; subtitle?: I18nText }>();
</script>
