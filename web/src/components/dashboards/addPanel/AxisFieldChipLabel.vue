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
  Renders a query-builder axis chip label with three visual layers, e.g.

      histogram(_anomalies._timestamp)
      ▔▔▔▔▔▔▔▔▔ fnClass (bold purple — the function)
               ▔▔▔▔▔▔▔▔▔▔▔ mutedClass ("(" + stream prefix, de-emphasized)
                          ▔▔▔▔▔▔▔▔▔▔ columnClass (bold warm orange — the column)

  Function and column are deliberately DIFFERENT colours ("histogram vs column
  colored inside chip"). Plain columns (no function, e.g. "audit.log_level")
  render prefix + bold field entirely in `columnClass`.

  Colours come only from registered badge-*/text-* token utilities — never raw
  Tailwind palette utilities, which palette-reset clears so they do not compile.
-->
<template>
  <span
    class="inline-flex items-center gap-1 leading-none font-normal"
    data-test="dashboard-axis-field-chip-label"
  >
    <template v-if="parsed.fn">
      <span class="whitespace-nowrap"
        ><span :class="fnClass">{{ parsed.fn }}</span
        ><span :class="bracketClass">(</span
        ><span :class="mutedClass">{{ parsed.prefix }}</span
        ><span :class="columnClass">{{ parsed.field }}</span
        ><span v-if="parsed.close" :class="bracketClass">{{
          parsed.close
        }}</span></span
      >
    </template>
    <span v-else class="whitespace-nowrap"
      ><span :class="mutedClass">{{ parsed.prefix }}</span
      ><span :class="columnClass">{{ parsed.field }}</span></span
    >
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** Full chip label, e.g. "histogram(_anomalies._timestamp)" or "audit.log_level" */
    label: string;
    /** Token utility for the leading function/aggregation name */
    fnClass?: string;
    /** Token utility for the emphasized field/column name */
    columnClass?: string;
    /** Token utility for the de-emphasized stream prefix before the field */
    mutedClass?: string;
    /** Token utility for the parentheses — blue like the query editor's brackets */
    bracketClass?: string;
  }>(),
  // Colours mirror the SQL query editor's syntax highlighting: function name
  // in the editor's magenta, the column reference in plain body text like an
  // identifier in the query.
  {
    fnClass: "text-badge-magenta-ol-text",
    columnClass: "text-text-body",
    mutedClass: "text-text-body",
    bracketClass: "text-badge-blue-ol-text",
  },
);

/**
 * Split a "stream.field" reference at its LAST dot: prefix keeps the trailing
 * dot ("_anomalies."), field is the emphasized final segment ("_timestamp").
 * References without a dot are all field. A truncation ellipsis ("...") is
 * excluded from the dot search — otherwise it wins lastIndexOf and the whole
 * label lands in the prefix — and is re-appended to the field.
 */
const splitColumnRef = (ref: string) => {
  const ellipsis = ref.match(/(\.{3}|…)$/)?.[1] ?? "";
  const core = ellipsis ? ref.slice(0, -ellipsis.length) : ref;
  const idx = core.lastIndexOf(".");
  return idx === -1
    ? { prefix: "", field: ref }
    : { prefix: core.slice(0, idx + 1), field: core.slice(idx + 1) + ellipsis };
};

// Split "fn(args)" into function name + de-emphasized prefix + bold field.
// The closing paren is OPTIONAL so truncated labels ("count(stream.long_fie…")
// still get the function name colored. Non-function labels (plain columns /
// aliases) fall through as fn = "".
const parsed = computed(() => {
  const match = props.label?.match(/^\s*([A-Za-z_][\w-]*)\s*\((.*?)(\))?\s*$/);
  if (match) {
    const inner = match[2];
    // Nested calls / multi-arg expressions stay whole in the field slot.
    const simple = !/[()]/.test(inner);
    const { prefix, field } = simple
      ? splitColumnRef(inner)
      : { prefix: "", field: inner };
    return { fn: match[1], prefix, field, close: match[3] ?? "" };
  }
  return { fn: "", close: "", ...splitColumnRef(props.label ?? "") };
});
</script>
