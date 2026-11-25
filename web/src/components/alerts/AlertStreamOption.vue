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
import { computed } from "vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import type { StreamOption } from "@/composables/alerts/useStreamDiscovery";

const props = defineProps<{ option: SelectOption }>();
// The picker hands back the row it was given, built by streamOptions.
const row = computed(() => props.option as StreamOption);
</script>

<template>
  <span
    class="flex w-full min-w-0 flex-col gap-1 overflow-hidden leading-snug"
    :data-stale="row.stale || undefined"
    data-test="add-alert-stream-option"
  >
    <OTruncatedText
      class="font-medium"
      :class="row.stale ? 'text-text-secondary' : 'text-text-body'"
      >{{ row.label }}</OTruncatedText
    >
    <OTruncatedText
      v-if="row.subLabel"
      class="text-xs"
      :class="row.stale ? 'text-text-muted' : 'text-text-secondary'"
      >{{ row.subLabel }}</OTruncatedText
    >
  </span>
</template>
