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

<!-- A trace matches when any of its spans matches the WHERE clause. -->
<template>
  <div class="px-page-edge pt-2" data-test="llm-insights-search">
    <div
      class="rounded-default bg-input-bg focus-within:border-input-border-focus focus-within:ring-focus-ring-accent flex h-[2.125rem] w-full items-center border ps-2 pe-1 transition-[color,background-color,border-color,box-shadow] duration-150 focus-within:ring-[0.125rem]"
      :class="error ? 'border-error-600' : 'border-input-border hover:border-input-border-hover'"
    >
      <OIcon name="search" size="sm" class="shrink-0" />
      <div class="llm-insights-search-editor relative h-full min-w-0 flex-1 py-1.5">
        <CodeQueryEditor
          ref="editorRef"
          editor-id="llm-insights-search-editor"
          v-model:query="draft"
          :keywords="effectiveKeywords"
          :suggestions="effectiveSuggestions"
          :field-value-resolver="resolveFieldValues"
          :values-time-range="valuesTimeRange"
          :show-line-numbers="false"
          :sticky-scroll="false"
          :debounce-time="100"
          filter-mode
          language="sql"
          @run-query="apply"
          @focus="bindEnter"
        />
        <span
          v-if="!draft"
          class="text-input-placeholder pointer-events-none absolute inset-y-0 start-0 flex items-center ps-2 text-sm"
        >
          {{ t("llmInsightsDrill.searchPlaceholder") }}
        </span>
      </div>
      <OButton
        v-if="draft"
        variant="ghost"
        size="icon-xs-sq"
        :aria-label="t('llmInsightsDrill.searchClear')"
        data-test="llm-insights-search-clear"
        @click="clear"
      >
        <OIcon name="close" size="sm" />
      </OButton>
    </div>
    <p v-if="error" class="text-error-600 mt-1 text-xs" data-test="llm-insights-search-error">
      {{ t("llmInsightsDrill.searchFailed", { reason: error }) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import useSqlSuggestions from "@/composables/useSuggestions";
import useStreams from "@/composables/useStreams";

const props = defineProps<{
  stream: string;
  /** The filter the page runs with now. */
  applied: string;
  /** The page's window (µs); value completion looks inside it. */
  startTime: number;
  endTime: number;
  /** Why the page's queries failed with this filter applied, if they did. */
  error?: string;
}>();
const emit = defineEmits<{ (e: "apply", query: string): void }>();

const { t } = useI18nTyped();
const store = useStore();
const { getStream } = useStreams(t);
const {
  autoCompleteData,
  effectiveKeywords,
  effectiveSuggestions,
  updateFieldKeywords,
  resolveFieldValues,
  setValuesTimeRange,
} = useSqlSuggestions();

const editorRef = ref<{ getValue?: () => string; editorObj?: any } | null>(null);
const draft = ref(props.applied);
// A clause added from elsewhere on the page (a chart click) replaces the draft.
watch(
  () => props.applied,
  (value) => {
    draft.value = value;
  },
);

const valuesTimeRange = computed(() => ({ startTime: props.startTime, endTime: props.endTime }));
watch(valuesTimeRange, (range) => setValuesTimeRange(range), { immediate: true });
onUnmounted(() => setValuesTimeRange(null));

// Field completion comes from the stream's schema; value completion asks the stream.
watch(
  () => props.stream,
  async (stream) => {
    autoCompleteData.value.org = store.state.selectedOrganization?.identifier ?? "";
    autoCompleteData.value.streamType = "traces";
    autoCompleteData.value.streamName = stream;
    if (!stream) {
      updateFieldKeywords([]);
      return;
    }
    const schema = await getStream(stream, "traces", true).catch(() => null);
    if (stream === props.stream) updateFieldKeywords(schema?.schema ?? []);
  },
  { immediate: true },
);

// Read from the editor: its model update is debounced, so a quick Enter would apply stale text.
function apply() {
  const text = (editorRef.value?.getValue?.() ?? draft.value).trim();
  draft.value = text;
  emit("apply", text);
}

function clear() {
  draft.value = "";
  if (props.applied) emit("apply", "");
}

// Bound on first focus: the editor exists only once Monaco has loaded.
let enterBound = false;
async function bindEnter() {
  const editor = editorRef.value?.editorObj;
  if (enterBound || !editor?.addAction) return;
  enterBound = true;
  const { KeyCode } = await import("monaco-editor/esm/vs/editor/editor.api");
  editor.addAction({
    id: "o2.llmInsightsSearch.apply",
    label: t("llmInsightsDrill.searchApply"),
    keybindings: [KeyCode.Enter],
    precondition: "textInputFocus && !suggestWidgetVisible",
    run: apply,
  });
}
</script>

<style scoped>
/* keep(lib-override:code-query-editor): the search box draws surface and focus ring. */
.llm-insights-search-editor :deep(.logs-query-editor) {
  background: transparent;
  box-shadow: none;
}
.llm-insights-search-editor :deep(.monaco-editor),
.llm-insights-search-editor :deep(.monaco-editor-background) {
  background-color: transparent;
}
/* One line: a vertical scrollbar only shows when the line is taller than the box. */
.llm-insights-search-editor :deep(.scrollbar.vertical) {
  display: none;
}
</style>
