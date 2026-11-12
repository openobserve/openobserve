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
import SuggestedChip from "./SuggestedChip.vue";

defineProps<{
  text: I18nText;
  /** True only while the field still holds the value AutoObserve inferred. */
  chip?: boolean;
}>();
</script>

<template>
  <p class="text-text-secondary flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
    <SuggestedChip v-if="chip" />
    <span>{{ text }}</span>
  </p>
</template>
