<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  One SQL-predicate field on the SLO form, backed by the SAME editor the logs
  search bar uses.

  A plain text input was the wrong tool: these fragments are SQL, and the
  editor already provides field autocomplete from the stream's schema, syntax
  highlighting and bracket matching — all of it wired to the app's existing
  suggestion machinery. Nothing here reimplements any of
  that; this only supplies the label / hint / border chrome a form field needs
  around what is otherwise a bare editor surface.

  Sized to a SINGLE line at `OInput`'s height: a scope or good-when predicate
  is one short expression, and these sit among plain inputs. Newlines are
  collapsed on emit (see `onUpdate`) so a pasted multi-line fragment cannot
  reach the payload as one.
-->
<template>
  <div :data-test="dataTest">
    <label class="text-text-secondary mb-1 block text-xs">
      {{ label }}<span v-if="required" class="text-text-body"> *</span>
    </label>
    <!-- The editor is `h-full` and takes its height from here. SINGLE LINE, at
         exactly `OInput`'s height, so these sit on the same rhythm as the
         plain inputs around them rather than reading as the form's primary
         content. Monaco does not wrap by default and its horizontal scrollbar
         is `auto`, so a long predicate scrolls sideways — which is the
         single-line behaviour we want, not clipped text. -->
    <div
      class="rounded-default border-border-default bg-surface-base h-[2.125rem] overflow-hidden border"
      :class="focused ? 'border-input-border-focus' : ''"
    >
      <CodeQueryEditor
        :editor-id="editorId"
        :query="modelValue ?? ''"
        language="sql"
        :keywords="keywords"
        :suggestions="suggestions"
        :show-line-numbers="false"
        :sticky-scroll="false"
        :data-test="`${dataTest}-editor`"
        @update:query="onUpdate"
        @focus="focused = true"
        @blur="focused = false"
      />
    </div>
    <p v-if="hint" class="text-text-secondary mt-1 text-xs">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

import CodeQueryEditor from "@/components/CodeQueryEditor.vue";

withDefaults(
  defineProps<{
    modelValue?: string;
    /** Monaco needs a unique id per instance, or two editors share one model. */
    editorId: string;
    label: string;
    hint?: string;
    required?: boolean;
    /** Field/function completions, from the parent's `useSqlSuggestions`. */
    keywords?: unknown[];
    suggestions?: unknown[] | null;
    dataTest?: string;
  }>(),
  {
    modelValue: "",
    keywords: () => [],
    suggestions: null,
  },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const focused = ref(false);

/// The editor emits its full content; newlines are legal SQL but would be
/// stored verbatim in a one-line predicate, so they collapse to spaces.
function onUpdate(value: string) {
  emit("update:modelValue", (value ?? "").replace(/\s*\n\s*/g, " "));
}
</script>
