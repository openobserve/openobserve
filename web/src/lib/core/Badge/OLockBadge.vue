<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
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
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { I18nText } from "@/types/i18n";

defineProps<{
  /** Screen-reader text; omit when the host already carries the lock in its own name. */
  label?: I18nText;
}>();
</script>

<template>
  <span
    class="bg-surface-base absolute -end-1 -top-1 z-1 flex size-3.5 items-center justify-center rounded-full"
  >
    <OIcon name="lock" size="xs" class="text-icon-locked" aria-hidden="true" />
    <span v-if="label" class="sr-only">{{ label }}</span>
  </span>
</template>
