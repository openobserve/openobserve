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
  <span class="logs-highlight-json" v-html="colorizedJson"></span>
</template>

<script setup lang="ts">
import { computed, withDefaults } from "vue";
import { useStore } from "vuex";
import { useLogsHighlighter } from "@/composables/useLogsHighlighter";

/**
 * Component Props Interface
 */
interface Props {
  data: any;
  showBraces?: boolean;
  showQuotes?: boolean;
  queryString?: string;
  simpleMode?: boolean; // Only highlighting, no semantic colorization
}

const props = withDefaults(defineProps<Props>(), {
  showBraces: true,
  showQuotes: false,
  queryString: "",
  simpleMode: false,
});

const store = useStore();
const { colorizeJson } = useLogsHighlighter();

/**
 * Main colorization logic with integrated highlighting
 * Uses the composable to avoid code duplication
 */
const colorizedJson = computed((): string => {
  return colorizeJson(
    props.data,
    store.state.theme === "dark",
    props.showBraces,
    props.showQuotes,
    props.queryString,
    props.simpleMode
  );
});
</script>

<style scoped>
.logs-highlight-json {
  font-family: monospace;
  font-size: 12px;
  word-break: break-word;
  display: inline;
}
</style>
