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
  One expression field on the SLO form, backed by the SAME editor the logs
  search bar uses. The expression is SQL, or PromQL where the SLI addresses a
  metrics stream — the two differ only in which typeahead drives the editor.

  A plain text input was the wrong tool: the editor already provides
  autocomplete, syntax highlighting and bracket matching for both languages —
  all of it wired to the app's existing suggestion machinery. Nothing here
  reimplements any of that; this only supplies the label / hint / border chrome
  a form field needs around what is otherwise a bare editor surface.

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
    <!-- Monaco paints its OWN background from the editor theme, and
         `myCustomTheme` sets `editor.background: #fafafa` — which is exactly
         `--color-grey-50`, the value `bg-card-bg` resolves to for the section
         behind this field. Identical colours, so the input vanished into the
         card. Neutralising the editor's own fill lets the wrapper's
         `bg-input-bg` (white, the same token OInput uses) show through, which
         is what makes this read as a field like the ones around it.

         Overridden here rather than in the theme: `editor.background` is
         global, and the logs search bar and query editors are built expecting
         that grey. -->
    <div
      class="rounded-default border-input-border bg-input-bg h-[2.125rem] overflow-hidden border [&_.monaco-editor]:bg-transparent [&_.monaco-editor_.margin]:bg-transparent [&_.monaco-editor-background]:bg-transparent"
      :class="focused ? 'border-input-border-focus' : ''"
    >
      <!-- Keyed by language: monaco reads `language` ONCE, when it is created —
           it registers the grammar and the completion providers there and
           watches nothing — so re-binding the prop on a live editor would
           leave a SQL editor behind a PromQL field. -->
      <CodeQueryEditor
        :key="editorLanguage"
        ref="editorRef"
        :editor-id="scopedEditorId"
        :query="modelValue ?? ''"
        :language="editorLanguage"
        :keywords="editorKeywords"
        :suggestions="editorSuggestions"
        :field-value-resolver="editorFieldValueResolver"
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
import { computed, ref } from "vue";

import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import usePromqlSuggestions from "@/composables/usePromqlSuggestions";
import type { I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    /** Monaco needs a unique id per instance, or two editors share one model. */
    editorId: string;
    label: I18nText;
    hint?: I18nText;
    required?: boolean;
    /** The API's discriminator (`prom_ql`), not monaco's language id. A metrics
     *  stream can be addressed in either language, so the caller chooses. */
    language?: "sql" | "prom_ql";
    /** Field/function completions, from the parent's `useSqlSuggestions`.
     *  Ignored in PromQL, which has its own. */
    keywords?: unknown[];
    suggestions?: unknown[] | null;
    /** Field-value lookup, awaited by the completion provider. */
    fieldValueResolver?: ((field: string) => Promise<string[]>) | null;
    dataTest?: string;
  }>(),
  {
    modelValue: "",
    language: "sql",
    keywords: () => [],
    suggestions: null,
    fieldValueResolver: null,
  },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const focused = ref(false);

const isPromql = computed(() => props.language === "prom_ql");
const editorLanguage = computed(() => (isPromql.value ? "promql" : "sql"));
// A distinct DOM id per language, because the editor locates its host by
// `getElementById` and RETRIES for half a second — on a flip, the outgoing
// instance's pending lookup would otherwise find the incoming host and attach
// the wrong language to it. Suffixed only for PromQL, so the SQL editor keeps
// the id it has always had.
const scopedEditorId = computed(() =>
  isPromql.value ? `${props.editorId}-promql` : props.editorId,
);

// PromQL completions come from their own machinery: the metric's labels and
// their values, not the stream's SQL columns. Nothing here reimplements it —
// this only supplies the cursor and the popup handles it needs.
const {
  autoCompleteData: promqlAutoCompleteData,
  autoCompletePromqlKeywords,
  getSuggestions: getPromqlSuggestions,
} = usePromqlSuggestions();

const editorKeywords = computed(() =>
  isPromql.value ? autoCompletePromqlKeywords.value : props.keywords,
);
// A SQL suggestion list and a field-value resolver over a metrics stream both
// answer the wrong question, so PromQL gets neither.
const editorSuggestions = computed(() =>
  isPromql.value ? undefined : (props.suggestions ?? undefined),
);
const editorFieldValueResolver = computed(() =>
  isPromql.value ? undefined : (props.fieldValueResolver ?? undefined),
);

/** The slice of the editor the PromQL typeahead drives itself through. */
interface EditorHandle {
  getCursorIndex: () => number | null;
  triggerAutoComplete: (value: string) => void;
  disableSuggestionPopup: () => void;
}
const editorRef = ref<EditorHandle | null>(null);

/// The editor emits its full content; newlines are legal in both languages but
/// would be stored verbatim in a one-line expression, so they collapse to
/// spaces.
function onUpdate(value: string) {
  const collapsed = (value ?? "").replace(/\s*\n\s*/g, " ");
  emit("update:modelValue", collapsed);
  if (isPromql.value) requestPromqlSuggestions(collapsed);
}

/**
 * Unlike the SQL typeahead, which is a static list handed down as props, the
 * PromQL one is CURSOR-driven: whether the next completion is a label name, a
 * label value or the language itself depends on where the caret sits.
 */
function requestPromqlSuggestions(value: string) {
  const editor = editorRef.value;
  if (!editor) return;
  promqlAutoCompleteData.value.query = value;
  promqlAutoCompleteData.value.position.cursorIndex = editor.getCursorIndex() ?? 0;
  // Through the ref rather than bound to this instance: a label lookup is a
  // network call, and the editor it started on can be disposed — by a language
  // flip or by leaving the form — before the answer arrives.
  promqlAutoCompleteData.value.popup.open = (text: string) =>
    editorRef.value?.triggerAutoComplete(text);
  promqlAutoCompleteData.value.popup.close = () => editorRef.value?.disableSuggestionPopup();
  getPromqlSuggestions();
}
</script>
