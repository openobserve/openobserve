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

<!-- One line of agent text with the thread notes' marks: code, bold and italics, never raw markers. -->
<template>
  <template v-for="(segment, idx) in segments" :key="idx">
    <template v-if="segment.kind === 'cite'">[{{ segment.id }}]</template>
    <code
      v-else-if="segment.code"
      class="rounded-default bg-surface-subtle text-text-code px-1 font-mono text-[0.875em]"
      :class="{ 'font-bold': segment.bold, italic: segment.italic }"
      >{{ segment.text }}</code
    >
    <strong v-else-if="segment.bold" class="font-bold" :class="{ italic: segment.italic }">{{
      segment.text
    }}</strong>
    <em v-else-if="segment.italic">{{ segment.text }}</em>
    <template v-else>{{ segment.text }}</template>
  </template>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { splitRcaNote } from "@/utils/incidents/rcaThread";

const props = defineProps<{ text: string }>();

const segments = computed(() => splitRcaNote(props.text));
</script>
