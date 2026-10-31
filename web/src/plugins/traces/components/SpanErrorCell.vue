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
  <span
    v-if="error"
    class="inline-flex max-w-full min-w-0 items-center gap-1.5"
    data-test="span-error-cell"
  >
    <SpanStatusCodeBadge v-if="error.code" class="shrink-0" :code="error.code" />
    <OTruncatedText
      v-if="error.message"
      class="text-status-error-text text-xs"
      data-test="span-error-cell-message"
    >
      {{ error.message }}
    </OTruncatedText>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import SpanStatusCodeBadge from "./SpanStatusCodeBadge.vue";
import { spanResultCellsFor } from "./spanResultCells";

const props = defineProps<{
  row: Record<string, unknown>;
  timestampField?: string;
}>();

const error = computed(() => spanResultCellsFor(props.row, props.timestampField).error);
</script>
