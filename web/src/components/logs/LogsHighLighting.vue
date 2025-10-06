<!-- Copyright 2023 OpenObserve Inc.

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

<!--
LogsHighLighting Component
===============================
A Vue component that intelligently colorizes JSON data and log lines with syntax highlighting and keyword highlighting.

Features:
- Colorizes JSON objects with different colors for keys, values, and structural elements
- Detects and highlights semantic types in log lines (IPs, URLs, timestamps, etc.)
- Highlights matching keywords from query strings with yellow background
- Theme-aware coloring that adapts to light/dark modes
- Handles primitive values (strings, numbers, booleans, null)
- Smart tokenization that preserves quoted strings and bracketed content

Usage Examples:
- <LogsHighLighting :data="{name: 'John', age: 25}" />  // JSON object
- <LogsHighLighting :data="'192.168.1.1'" :query-string="match_all('192')" />  // IP with highlighting
- <LogsHighLighting :data="false" />  // Boolean value
- <LogsHighLighting :data="1234567890123" />  // Timestamp-like number
-->
<template>
  <span
    class="logs-highlight-json"
    v-html="processedResults[`${props.column.id}_${props.index}`]"
  ></span>
</template>

<script setup lang="ts">
import { computed, withDefaults } from "vue";
import { useLogsHighlighter } from "@/composables/useLogsHighlighter";

/**
 * Component Props Interface
 */
interface Props {
  column: any; // Only highlighting, no semantic colorization
  index: number;
}

const props = withDefaults(defineProps<Props>(), {
  column: {},
});

const { processedResults } = useLogsHighlighter();

defineExpose({
  processedResults,
});
</script>

<style scoped>
.logs-highlight-json {
  font-family: monospace;
  font-size: 12px;
  word-break: break-word;
  display: inline;
}

/* Import log highlighting CSS classes */
@import '@/assets/styles/log-highlighting.css';
</style>
