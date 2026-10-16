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
    class="rounded-surface border-border-default overflow-auto border font-mono text-xs"
    data-test="fleet-config-diff"
  >
    <div
      v-for="(line, i) in lines"
      :key="i"
      class="grid grid-cols-[1.5rem_minmax(0,1fr)] px-2 leading-5 whitespace-pre"
      :class="lineClass(line.kind)"
    >
      <span class="text-text-secondary select-none">{{ marker(line.kind) }}</span>
      <span>{{ line.text }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw } from "@/types/i18n";
import { diffLines } from "./configDiff";

const props = defineProps<{ before: string; after: string }>();

const lines = computed(() => diffLines(props.before, props.after));

function lineClass(kind: "same" | "add" | "del") {
  if (kind === "add") return "bg-status-success-bg text-status-success-text";
  if (kind === "del") return "bg-status-error-bg text-status-error-text";
  return "text-text-body";
}

function marker(kind: "same" | "add" | "del") {
  if (kind === "add") return raw("+");
  if (kind === "del") return raw("-");
  return raw(" ");
}
</script>
