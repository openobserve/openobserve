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
  Axis chip label with the SQL editor's highlighting: every function name (nested
  too) magenta, columns body text, parentheses coloured by nesting depth.
-->
<template>
  <span
    class="inline-flex items-center gap-1 leading-none font-normal"
    data-test="dashboard-axis-field-chip-label"
  >
    <span class="whitespace-nowrap"><span
      v-for="(seg, i) in segments"
      :key="i"
      :class="seg.cls"
    >{{ seg.text }}</span></span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** Full chip label, e.g. "histogram(_timestamp, acos(actual_value))" */
    label: string;
    /** Token utility for every function/aggregation name (nested included) */
    fnClass?: string;
    /** Token utility for the emphasized field/column name */
    columnClass?: string;
    /** Token utility for the de-emphasized stream prefix and separators */
    mutedClass?: string;
  }>(),
  // Colours mirror the SQL query editor's syntax highlighting: function names in
  // magenta, the column references in plain body text like an identifier.
  {
    fnClass: "text-badge-magenta-ol-text",
    columnClass: "text-text-body",
    mutedClass: "text-text-body",
  },
);

// Parentheses coloured by nesting depth, cycling 3 tokens (Monaco rainbow brackets).
const BRACKET_CLASSES = [
  "text-bracket-1",
  "text-bracket-2",
  "text-bracket-3",
] as const;

// Split "stream.field" at its last dot into prefix + field. A trailing
// truncation ellipsis is kept out of the dot search and re-appended to the field.
const splitColumnRef = (ref: string) => {
  const ellipsis = ref.match(/(\.{3}|…)$/)?.[1] ?? "";
  const core = ellipsis ? ref.slice(0, -ellipsis.length) : ref;
  const idx = core.lastIndexOf(".");
  return idx === -1
    ? { prefix: "", field: ref }
    : { prefix: core.slice(0, idx + 1), field: core.slice(idx + 1) + ellipsis };
};

interface Segment {
  text: string;
  cls: string;
}

type TokenKind = "word" | "paren" | "comma" | "space" | "other";
interface Token {
  raw: string;
  kind: TokenKind;
}

// Tokenise the label so every function name (identifier before "(") is coloured,
// nested calls included. Non-function identifiers are column refs.
const segments = computed<Segment[]>(() => {
  const label = props.label ?? "";
  // word (identifiers incl. dots/hyphens/ellipsis) | paren | comma | whitespace | other
  const TOKEN_RE = /([A-Za-z_][\w.\-…]*)|([()])|(,)|(\s+)|([^A-Za-z_(),\s]+)/g;

  const tokens: Token[] = [];
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(label)) !== null) {
    if (m[1] !== undefined) tokens.push({ raw: m[1], kind: "word" });
    else if (m[2] !== undefined) tokens.push({ raw: m[2], kind: "paren" });
    else if (m[3] !== undefined) tokens.push({ raw: m[3], kind: "comma" });
    else if (m[4] !== undefined) tokens.push({ raw: m[4], kind: "space" });
    else tokens.push({ raw: m[5], kind: "other" });
  }

  const out: Segment[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "word") {
      // A word is a function iff the next non-whitespace token is "(".
      let j = i + 1;
      while (j < tokens.length && tokens[j].kind === "space") j++;
      const isFn =
        j < tokens.length && tokens[j].raw === "(" && !t.raw.includes(".");
      if (isFn) {
        out.push({ text: t.raw, cls: props.fnClass });
      } else {
        const { prefix, field } = splitColumnRef(t.raw);
        if (prefix) out.push({ text: prefix, cls: props.mutedClass });
        if (field) out.push({ text: field, cls: props.columnClass });
      }
    } else if (t.kind === "paren") {
      // Colour by depth; close ascends first so it matches its opener.
      if (t.raw === "(") {
        out.push({ text: t.raw, cls: BRACKET_CLASSES[depth % 3] });
        depth++;
      } else {
        depth = Math.max(0, depth - 1);
        out.push({ text: t.raw, cls: BRACKET_CLASSES[depth % 3] });
      }
    } else {
      // comma / whitespace / other — neutral separators
      out.push({ text: t.raw, cls: props.mutedClass });
    }
  }
  return out;
});
</script>
