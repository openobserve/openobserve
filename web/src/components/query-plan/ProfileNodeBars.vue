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
  <div class="flex h-3.5 items-end gap-0.5" :data-test="dataTest">
    <span
      v-for="b in bars"
      :key="b.key"
      class="rounded-t-default min-w-0 flex-1"
      :class="TONE[b.tone]"
      :style="{ height: `${Math.max(14, b.ratio * 100)}%` }"
      :title="b.title"
    />
  </div>
</template>

<script setup lang="ts">
import type { NodeBar } from "./profileStyles";

defineProps<{
  bars: NodeBar[];
  dataTest?: string;
}>();

const TONE: Record<NodeBar["tone"], string> = {
  default: "bg-status-positive",
  hot: "bg-status-negative",
  off: "bg-border-strong",
};
</script>
