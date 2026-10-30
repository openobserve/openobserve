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

<!--
  AlertQueryPreview — an alert's whole query, read-only and highlighted.

  One implementation for every surface that shows the query the alert will
  actually run: the create/edit alert page's "view the alert query" hint and the
  alert library's detail drawer.
-->
<template>
  <pre
    class="hljs rounded-default m-0 p-2 font-mono text-xs whitespace-pre-wrap"
    v-html="highlighted"
  />
</template>

<script setup lang="ts">
import hljs from "highlight.js/lib/core";
import sql from "highlight.js/lib/languages/sql";
import { computed } from "vue";

hljs.registerLanguage("sql", sql);

const props = withDefaults(defineProps<{ query?: string; language?: string }>(), {
  query: "",
  language: "sql",
});

// hljs escapes its own output, so it is safe to v-html. An unknown grammar
// (PromQL has none) falls back to escaped text rather than highlightAuto, which
// guesses a language and mislabels operators.
const highlighted = computed(() => {
  if (!props.query) return "";
  if (hljs.getLanguage(props.language)) {
    return hljs.highlight(props.query, { language: props.language }).value;
  }
  return props.query.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
});
</script>
