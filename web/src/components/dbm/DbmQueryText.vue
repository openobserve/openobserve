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
  DbmQueryText — read-only, syntax-highlighted normalized statement.

  Uses Monaco's `colorize` (the string API) rather than a CodeQueryEditor
  instance, which is what DbSpanDetails mounts. An editor brings a gutter, a
  wheel-capture and a mandatory fixed height for text the user can only read;
  `colorize` returns HTML that wraps and sizes itself. The language map is
  copied from DbSpanDetails so the same statement highlights identically
  whether it is reached from a span or from Database Monitoring.

  The output is sanitized before `v-html`: `colorize` is given a stored,
  server-provided string, and its failure path returns escaped plain text
  (GHSA-hx23-g7m8-h76j).
-->
<template>
  <div
    class="border-border-default border-l-sql-accent bg-surface-subtle o2-colorized-query overflow-auto border border-l-3 p-2.5"
    :data-test="dataTest"
  >
    <!-- eslint-disable-next-line vue/no-v-html -- Monaco colorize output, passed through DOMPurify.sanitize in the watcher below -->
    <pre
      v-if="highlighted"
      class="text-compact text-text-body m-0 font-mono break-words whitespace-pre-wrap"
      v-html="highlighted"
    ></pre>
    <pre v-else class="text-compact text-text-body m-0 font-mono break-words whitespace-pre-wrap">{{
      query
    }}</pre>
  </div>
</template>

<script setup lang="ts">
import DOMPurify from "dompurify";
import { ref, watch } from "vue";

import { colorizeQuery } from "@/utils/query/colorizeQuery";

const props = withDefaults(
  defineProps<{
    /** The normalized statement. Rendered verbatim until highlighting lands. */
    query: string;
    /** `db_system` — picks the grammar. Unknown systems fall back to SQL. */
    dbSystem?: string;
    dataTest?: string;
  }>(),
  { dbSystem: "", dataTest: "dbm-query-text" },
);

/** Same mapping as DbSpanDetails.vue, so one statement never highlights two ways. */
const languageFor = (system: string): string => {
  switch (system) {
    case "redis":
      return "plaintext";
    case "mongodb":
      return "javascript";
    case "elasticsearch":
      return "json";
    default:
      return "sql";
  }
};

const highlighted = ref("");

watch(
  () => [props.query, props.dbSystem] as const,
  async ([query, dbSystem]) => {
    if (!query) {
      highlighted.value = "";
      return;
    }
    const html = await colorizeQuery(query, languageFor(dbSystem));
    // The plain-text branch above stays visible if this races or fails, so a
    // highlighting problem degrades to unstyled text rather than a blank box.
    if (props.query === query) highlighted.value = DOMPurify.sanitize(html);
  },
  { immediate: true },
);
</script>
