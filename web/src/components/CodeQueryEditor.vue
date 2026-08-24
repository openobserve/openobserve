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

<template>
  <div class="relative flex h-full w-full flex-col" v-bind="$attrs">
    <div
      data-test="query-editor"
      class="logs-query-editor bg-card-glass-bg min-h-0 flex-1"
      :class="{ 'promql-mode': language === 'promql' }"
      ref="editorRef"
      :id="editorId"
    />
    <!-- AI Icon Button -->
    <OButton
      v-if="showAiIcon && !disableAi"
      variant="sidebar-toggle"
      size="icon-toolbar"
      class="bg-card-glass-bg border-card-glass-border hover:bg-button-outline-hover-bg hover:border-accent absolute! top-2 right-2 z-10 border transition-all duration-200"
      :class="nlpMode ? 'bg-surface-accent-active border-accent' : ''"
      @click="toggleNlpMode"
      data-test="query-editor-ai-icon-btn"
    >
      <!-- name="" satisfies the required prop; empty name renders only the slot -->
      <OIcon name="" size="md">
        <img :src="aiIcon" :alt="t('search.aiIconAlt')" class="h-4.5 w-4.5" />
      </OIcon>
      <OTooltip side="top" align="center">
        <template #content>{{
          disableAiReason || t(nlpMode ? "search.nlpModeEnabled" : "search.nlpModeLabel")
        }}</template>
      </OTooltip>
    </OButton>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  nextTick,
  onDeactivated,
  onUnmounted,
  onActivated,
  watch,
  computed,
  type PropType,
} from "vue";

import type * as MonacoEditor from "monaco-editor/esm/vs/editor/editor.api";

// Lazy load Monaco Editor - only loaded when this component is rendered
// This reduces initial bundle size by ~3.1MB
let monaco: any = null;
const loadMonaco = async () => {
  if (!monaco) {
    // editor.api must be imported first — it bootstraps StandaloneServices (the
    // Monaco DI container). Importing editor.all.js before api causes feature
    // contributions (ICodeLensCache, ISuggestMemories, actionWidgetService, etc.)
    // to register against an uninitialised container, producing "[createInstance]
    // X depends on UNKNOWN service" errors that silently degrade intellisense.
    monaco = await import("monaco-editor/esm/vs/editor/editor.api");
    await import("monaco-editor/esm/vs/editor/editor.all.js");
  }
  return monaco;
};

import { vrlLanguageDefinition } from "@/utils/query/vrlLanguageDefinition";

/**
 * Per-editor configuration, keyed by model URI.
 *
 * Monaco aggregates every provider registered for a language, so registering
 * one per component meant N providers answering each keystroke and N-1 of them
 * returning an empty list for a model that did not ask. One provider set per
 * language now, looking its editor up by model.
 */
interface EditorConfig {
  enabled: () => boolean;
  keywords: () => any[];
  suggestions: () => any[];
  resolveFieldValues: () => ((field: string) => Promise<string[]>) | null;
}
const editorConfigs = new Map<string, EditorConfig>();
const registeredLanguages = new Set<string>();
const modelKey = (model: any): string => model?.uri?.toString?.() ?? "";
import {
  resolveKeywords,
  resolveSuggestions,
  buildCompletionItems,
} from "@/utils/query/sqlCompletion";
import {
  parseCallContext,
  parseValueContext,
  buildValueEntries,
  buildSignatureHelp,
  buildHoverContents,
  findCatalogEntry,
  findFunctionEntry,
  wantsNumericColumn,
  rankNumericFieldsFirst,
} from "@/utils/query/editorProviders";
import { findDoubleQuoteIssues } from "@/utils/query/doubleQuoteWarnings";
import { loadPromqlLanguage } from "@/utils/query/promqlLanguageDefinition";

import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { debounce } from "lodash-es";
import searchState from "@/composables/useLogs/searchState";
import { useNLQuery } from "@/composables/useNLQuery";
import { type I18nText, useI18nTyped, raw } from "@/types/i18n";
import useNotifications from "@/composables/useNotifications";
import { getImageURL } from "@/utils/zincutils";
import { isAuthError } from "@/utils/authErrors";
import { getFontMono } from "@/utils/fonts";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
export default defineComponent({
  inheritAttrs: false,
  components: { OButton, OIcon, OTooltip },
  props: {
    editorId: {
      type: String,
      default: "editor",
    },
    query: {
      type: String,
      default: "",
    },
    showAutoComplete: {
      type: Boolean,
      default: true,
    },
    keywords: {
      type: Array,
      default: () => [],
    },
    suggestions: {
      type: Array,
      default: null,
    },
    debounceTime: {
      type: Number,
      default: 500,
    },
    readOnly: {
      type: Boolean,
      default: false,
    },
    showLineNumbers: {
      type: Boolean,
      default: true,
    },
    stickyScroll: {
      type: Boolean,
      default: true,
    },
    // When true (the app-wide default), the editor releases the mouse wheel to
    // the page once its own content has nothing left to scroll — Monaco
    // otherwise always consumes the wheel, trapping page scroll on hover. It
    // still scrolls internally when its content overflows. Set to false for a
    // full-page editor that should own the wheel even when not overflowing.
    releaseWheelToPage: {
      type: Boolean,
      default: true,
    },
    language: {
      type: String,
      default: "sql",
    },
    functions: {
      type: Array,
      default: () => [],
    },
    fields: {
      type: Array,
      default: () => [],
    },
    nlpMode: {
      type: Boolean,
      default: false,
    },
    showAiIcon: {
      type: Boolean,
      default: false,
    },
    disableAi: {
      type: Boolean,
      default: false,
    },
    disableAiReason: {
      type: String as unknown as PropType<I18nText>,
      default: raw(""),
    },
    /**
     * Resolves the values of one field, awaited by the completion provider.
     * Absent on surfaces that have none — pass `undefined`, not `null`, so the
     * declared default applies.
     */
    fieldValueResolver: {
      type: Function as PropType<(field: string) => Promise<string[]>>,
      default: null,
    },
  },
  emits: [
    "update-query",
    "run-query",
    "update:query",
    "focus",
    "blur",
    "nlpModeDetected",
    "generation-start",
    "generation-end",
    "generation-success",
    "toggle-nlp-mode",
  ],
  setup(props, { emit }) {
    const store = useStore();
    const { isDark } = useTheme();
    const { t } = useI18nTyped();
    const { showErrorNotification } = useNotifications();
    const editorRef: any = ref();
    let editorObj: any = null;
    // Emits the editor's content immediately instead of waiting out the change
    // debounce. Assigned when the editor is created; see `commitModelChange`.
    let commitPendingChange: (() => void) | null = null;
    const { searchObj } = searchState();
    const { detectNaturalLanguage, generateSQL, transformToSQL, isGenerating, streamingResponse } =
      useNLQuery(t);

    const currentEditorText = ref("");

    watch(
      () => isDark.value,
      () => {
        if (!monaco) return;
        monaco.editor.setTheme(isDark.value ? "myCustomDarkTheme" : "myCustomTheme");
      },
    );

    // Both fall back to the shared catalog so every surface (Logs, Traces,
    // Dashboards, Alerts, Pipelines) is served identical content. Traces passes
    // no `suggestions` prop and used to get a 7-entry local list with no
    // aggregate functions at all.
    const keywords = computed(() => resolveKeywords(props.language, props.keywords as any[]));
    const suggestions = computed(() =>
      resolveSuggestions(props.language, props.suggestions as any[] | null),
    );

    /**
     * Debounced function to detect natural language and auto-toggle NLP mode
     * Waits 500ms after user stops typing before checking
     *
     * CRITICAL BEHAVIOR:
     * - If NOT in NLP mode: Auto-detect and emit event to turn ON NLP mode for natural language
     * - If ALREADY in NLP mode: Do NOT emit events (keep NLP mode ON regardless of what user types)
     * - NLP mode only turns OFF when AI successfully generates SQL query
     */
    const checkForNaturalLanguage = debounce((text: string) => {
      currentEditorText.value = text;
      const isNL = detectNaturalLanguage(text, props.language);

      // ONLY emit events if NOT already in NLP mode (auto-detection feature)
      // If already in NLP mode (user toggled it), don't change anything
      // Only emit when not already in NLP mode; if already set, do nothing.
      if (!props.nlpMode) {
        if (isNL) {
          emit("nlpModeDetected", true);
        } else {
          emit("nlpModeDetected", false);
        }
      }
    }, 500);

    /**
     * Handles Generate SQL button click
     * Calls AI to generate query based on current language (SQL, PromQL, VRL, JavaScript)
     * @param customText - Optional custom text to use instead of editor content
     */
    const handleGenerateSQL = async (
      customText?: string,
      abortSignal?: AbortSignal,
      sessionId?: string,
    ) => {
      const currentText = customText || currentEditorText.value;
      if (!currentText.trim()) return;

      const currentLanguage = props.language?.toLowerCase() || "sql";

      try {
        const orgId = store.state.selectedOrganization?.identifier || "default";

        // Create language-appropriate prompt
        let promptPrefix = "";
        switch (currentLanguage) {
          case "promql":
            promptPrefix = "Generate PromQL query";
            break;
          case "vrl":
            promptPrefix = "Generate VRL function";
            break;
          case "javascript":
            promptPrefix = "Generate JavaScript function";
            break;
          case "sql":
          default:
            promptPrefix = "Generate SQL query";
            break;
        }

        const prompt = `${promptPrefix} : ${currentText}`;

        // Generate query from natural language
        const generatedSQL = await generateSQL(prompt, orgId, abortSignal, sessionId);

        if (!generatedSQL || generatedSQL.trim() === "") {
          // Show error notification - use streaming error message if available (e.g. Unauthorized Access)
          const errorMsg = isAuthError(streamingResponse.value)
            ? streamingResponse.value
            : t("search.nlQueryGenerationFailed");
          showErrorNotification(raw(errorMsg));
          if (isAuthError(streamingResponse.value)) {
            return; // Auth error already handled, don't trigger catch block
          }
          throw new Error("Query generation failed");
        }

        // Check if this is a special action completion (dashboard/alert)
        if (generatedSQL.startsWith("✓ DASHBOARD_CREATED:")) {
          const responseText = generatedSQL.replace("✓ DASHBOARD_CREATED:", "").trim();
          emit("generation-success", {
            type: "dashboard",
            message: responseText,
          });
          // Don't emit nlpModeDetected - keep user in current mode
          return; // Success without SQL
        }

        if (generatedSQL.startsWith("✓ ALERT_CREATED:")) {
          const responseText = generatedSQL.replace("✓ ALERT_CREATED:", "").trim();
          emit("generation-success", { type: "alert", message: responseText });
          // Don't emit nlpModeDetected - keep user in current mode
          return; // Success without SQL
        }

        if (generatedSQL.startsWith("✓ ACTION_COMPLETED:")) {
          const responseText = generatedSQL.replace("✓ ACTION_COMPLETED:", "").trim();
          emit("generation-success", { type: "action", message: responseText });
          // Don't emit nlpModeDetected - keep user in current mode
          return; // Success without SQL
        }

        // Normal query generation - transform and update editor with language-specific comments
        const transformedText = transformToSQL(currentText, generatedSQL, props.language);

        // Update editor value
        setValue(transformedText);

        // Emit update events
        emit("update-query", transformedText);
        emit("update:query", transformedText);

        // Turn off NLP mode after generating SQL (we're now in SQL mode)
        emit("nlpModeDetected", false);

        // Emit SQL generation success
        emit("generation-success", { type: "sql", message: generatedSQL });
      } catch (error) {
        console.error("[NL2Q-UI] Exception during SQL generation:", error);
        showErrorNotification(t("search.nlQueryGenerationFailed"));
        throw error; // Re-throw so SearchBar can handle it
      }
    };

    /** Point this editor's model at its live configuration. */
    let publishedKey: string | null = null;
    const publishEditorConfig = () => {
      const key = modelKey(editorObj?.getModel?.());
      if (!key) return;
      publishedKey = key;
      // Getters, not snapshots: keywords and suggestions are computeds that
      // change as the stream schema and server catalog arrive.
      editorConfigs.set(key, {
        enabled: () => props.showAutoComplete,
        keywords: () => keywords.value as any[],
        suggestions: () => suggestions.value as any[],
        resolveFieldValues: () => (props.fieldValueResolver as any) ?? null,
      });
    };

    const setupEditor = async () => {
      // Lazy load Monaco Editor on first use
      const monacoModule = await loadMonaco();
      monaco = monacoModule;

      // Expose Monaco on window for e2e tests (read-only assertions against editor model).
      // Tests use: window.monaco.editor.getModels()[0].getValue()
      if (typeof window !== "undefined") {
        (window as any).monaco = monacoModule;
      }

      // Register custom languages after Monaco is loaded
      if (props.language === "promql") {
        monaco.languages.register({ id: "promql" });

        // The vendored PromQL grammar — without a tokenizer the
        // query renders monochrome (#9779, #9793).
        const promql = await loadPromqlLanguage();
        monaco.languages.setMonarchTokensProvider("promql", promql.language as any);
        monaco.languages.setLanguageConfiguration("promql", promql.languageConfiguration as any);
      }
      if (props.language === "vrl") {
        monaco.languages.register({ id: "vrl" });

        // Register a tokens provider for the language
        monaco.languages.setMonarchTokensProvider("vrl", vrlLanguageDefinition as any);
      }

      monaco.editor.defineTheme("myCustomTheme", {
        base: "vs", // can also be vs-dark or hc-black
        inherit: true, // can also be false to completely replace the builtin rules
        rules: [
          { token: "comment", background: "FFFFFF" },
          // PromQL: no rules on purpose — built-in "vs" colours via inherit.
        ],
        colors: {
          "editor.foreground": "#000000",
          "editor.background": "#fafafa",
          "editorCursor.foreground": "#000000",
          "editor.lineHighlightBackground": "#FFFFFF",
          "editorLineNumber.foreground": "#000000",
          "editor.border": "#000000",
        },
      });

      monaco.editor.defineTheme("myCustomDarkTheme", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "string", foreground: "CE9178" },
          { token: "string.sql", foreground: "CE9178" },
          { token: "string.vrl", foreground: "CE9178" },
          // PromQL: no rules on purpose — built-in "vs-dark" colours via inherit.
        ],
        colors: {},
      });

      // One provider set per language, shared by every editor of that language.
      registerLanguageProviders(props.language);

      let editorElement = document.getElementById(props.editorId);
      let retryCount = 0;
      const maxRetries = 5;

      // Retry mechanism to ensure the editor element is found
      while (!editorElement && retryCount < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for 100ms
        editorElement = document.getElementById(props.editorId);
        retryCount++;
      }

      if (!editorElement) {
        return;
      }

      // If editor already exists (hasChildNodes), update its value and options instead of returning
      if (editorElement && editorElement?.hasChildNodes()) {
        if (editorObj) {
          // Update editor value if different from current
          const currentValue = editorObj?.getValue();
          if (currentValue !== props.query?.trim()) {
            editorObj.setValue(props.query?.trim() || "");
          }

          // Update readonly option if different
          const currentReadOnly = editorObj.getRawOptions().readOnly;
          if (currentReadOnly !== props.readOnly) {
            editorObj.updateOptions({ readOnly: props.readOnly });
          }
          return;
        } else {
          // editorObj is null but element has children - stale DOM
          // Don't recreate if new props are empty/readonly (likely a stale mount with default props)
          // The existing editor in the DOM is probably correct
          if (!props.query?.trim() && props.readOnly) {
            return;
          }

          // New props have actual data - safe to recreate
          editorElement.innerHTML = "";
          // Fall through to create new editor below
        }
      }
      editorObj = monaco.editor.create(editorElement as HTMLElement, {
        value: props.query?.trim(),
        language: props.language,
        // Monaco paints its own text and ignores the CSS cascade — without this it
        // falls back to its built-in Menlo/Monaco/Courier New stack, which differs
        // per OS and from the rest of the app.
        fontFamily: getFontMono(),
        theme: isDark.value ? "myCustomDarkTheme" : "myCustomTheme",
        showFoldingControls: enableCodeFolding.value ? "always" : "never",
        folding: enableCodeFolding.value,
        wordWrap: "on",
        automaticLayout: true,
        lineNumbers: props.showLineNumbers ? "on" : "off",
        // Reserve a couple of gutter chars so the right-aligned line numbers get
        // left breathing room instead of sitting flush against the editor edge
        // (and so the gutter width doesn't visibly jump as digit count grows).
        lineNumbersMinChars: 2,
        overviewRulerLanes: 0,
        fixedOverflowWidgets: true,
        overviewRulerBorder: false,
        // Gap between the (right-aligned) line numbers and the code text. 3px was
        // too tight and made the digit visually collide with the first character.
        lineDecorationsWidth: 10,
        hideCursorInOverviewRuler: true,
        renderLineHighlight: "none",
        glyphMargin: false,
        scrollBeyondLastColumn: 0,
        scrollBeyondLastLine: false,
        // Small top/bottom breathing room so line 1 (and the cursor) doesn't
        // hug the top edge of the editor.
        padding: { top: 3, bottom: 3 },
        smoothScrolling: true,
        mouseWheelScrollSensitivity: 1,
        fastScrollSensitivity: 1,
        scrollbar: {
          horizontal: "auto",
          vertical: "visible",
          // Let the page scroll when this editor has nothing left to scroll.
          alwaysConsumeMouseWheel: !props.releaseWheelToPage,
        },
        find: {
          addExtraSpaceOnTop: false,
          autoFindInSelection: "never",
          seedSearchStringFromSelection: "never",
        },
        minimap: { enabled: false },
        readOnly: props.readOnly,
        renderValidationDecorations: "on",
        // Monaco defaults strings to 'off', which is why field-VALUE completion
        // used to need a forced hide/re-trigger to appear at all.
        quickSuggestions: { other: "on", comments: "off", strings: "on" },
        // Default is 'matchingDocuments'. Off for the QUERY languages only,
        // where every suggestion should come from the catalog and a word
        // scraped out of the query text is noise. VRL, JS, JSON and the rest
        // have no catalog, and there local word completion is the only
        // completion they have.
        wordBasedSuggestions:
          props.language === "sql" || props.language === "promql" ? "off" : "matchingDocuments",
        stickyScroll: {
          enabled: props.stickyScroll,
        },
      });

      publishEditorConfig();

      // The editor's content only reaches the parent after `debounceTime`. Held
      // as a named handle so it can be flushed on the paths that consume the
      // query (blur, run) — otherwise they act on the previous query and the
      // parent re-renders the editor from that stale state, dropping the edit.
      const commitModelChange = debounce((e: any) => {
        const newValue = editorObj?.getValue()?.trim();
        emit("update-query", newValue, e);
        emit("update:query", newValue, e);

        // Check for natural language after user stops typing (debounced)
        if (newValue) checkForNaturalLanguage(newValue);

        validateDoubleQuotes();
      }, props.debounceTime);

      // No-op when nothing is pending, so it is safe on any path that consumes
      // the query.
      commitPendingChange = () => commitModelChange.flush();

      editorObj.onDidChangeModelContent(commitModelChange);

      const runQuery = () => {
        commitModelChange.flush();
        emit("run-query");
      };

      editorObj.createContextKey("ctrlenter", true);
      editorObj.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runQuery, "ctrlenter");
      editorObj.onDidFocusEditorWidget(() => {
        emit("focus");

        // added hack to handle case where ctrl+enter / cmd+enter stops working after
        // user click on the result row and open sidebase or opensidebar from schedule search
        // This is because the editor loses focus and the context key "ctrlenter" is not active anymore, so we need to re-add the command on focus
        editorObj.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runQuery, "ctrlenter");
      });

      editorObj.onDidBlurEditorWidget(() => {
        const model = editorObj?.getModel();
        const value = model?.getValue();
        const trimmedValue = value?.trim();

        // Trimming on blur exists so a query committed for execution doesn't
        // carry incidental leading/trailing whitespace — but for markdown
        // (the content-template body editor) trailing blank lines ARE
        // meaningful content, not incidental whitespace, so skip the trim
        // there. Without this guard, clicking a toolbar button (which blurs
        // the editor) silently deletes trailing blank lines out from under
        // the click before its handler reads the selection — see the
        // list/heading toolbar cursor-position bug report.
        if (props.language !== "markdown" && value !== trimmedValue) {
          const lastLine = model.getLineCount();
          const lastLineLength = model.getLineLength(lastLine);

          // Create an edit operation that replaces the entire content
          // This preserves undo history becuase it treats this as a single edit operation
          //and it will be in the undo stack as one operation
          model.pushEditOperations(
            [],
            [
              {
                range: new monaco.Range(1, 1, lastLine, lastLineLength + 1),
                text: trimmedValue,
              },
            ],
            () => null,
          );
        }

        // Whatever was clicked (Apply, a query tab) is about to read the query.
        // Flush after the trim above so the committed value is the trimmed one.
        commitPendingChange?.();

        emit("blur");
      });

      const handleWindowClick = () => {
        editorObj?.layout();
      };

      const handleWindowResize = async () => {
        await nextTick();
        editorObj?.layout();
        // queryEditorRef.value.resetEditorLayout();
      };

      window.addEventListener("click", handleWindowClick);
      window.addEventListener("resize", handleWindowResize);

      // Store references for cleanup
      editorObj._windowClickHandler = handleWindowClick;
      editorObj._windowResizeHandler = handleWindowResize;

      // Validate the initial query value on mount
      validateDoubleQuotes();
    };

    // Monaco tokenizes a language only once its contribution has been imported,
    // and each is a separate chunk so a page pays for the one it uses. Factored
    // out of onMounted because a surface that switches language, such as the
    // export dialog's JSON and Terraform tabs, has to load the new one too.
    const loadLanguageContribution = async (language: string) => {
      if (language === "sql") {
        await import("monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js");
      }

      if (language === "json") {
        await import("monaco-editor/esm/vs/language/json/monaco.contribution.js");
      }

      if (language === "html") {
        await import("monaco-editor/esm/vs/language/html/monaco.contribution.js");
      }

      if (language === "markdown") {
        await import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js");
      }

      // Terraform / OpenTofu configuration, e.g. the alert and SLO exports.
      if (language === "hcl") {
        await import("monaco-editor/esm/vs/basic-languages/hcl/hcl.contribution.js");
      }

      if (language === "python") {
        await import("monaco-editor/esm/vs/basic-languages/python/python.contribution.js");
      }
      if (language === "javascript") {
        await import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js");
      }
    };

    // Retokenize in place rather than making the consumer remount: recreating the
    // editor to change language throws away the DOM, the scroll position and the
    // undo stack, which reads as a hitch on every toggle. Providers are left
    // alone deliberately; they register per language and re-registering here
    // would stack duplicates on a surface that toggles repeatedly.
    watch(
      () => props.language,
      async (language) => {
        if (!editorObj || !language) return;
        await loadLanguageContribution(language);
        const model = editorObj.getModel();
        if (model) monaco.editor.setModelLanguage(model, language);
      },
    );

    onMounted(async () => {
      await loadLanguageContribution(props.language);
      setupEditor();
    });

    onActivated(async () => {
      if (!editorObj) {
        setupEditor();
        editorObj?.layout();
      } else {
        registerLanguageProviders(props.language);
        publishEditorConfig();
      }
    });

    onDeactivated(() => {});

    onUnmounted(() => {
      // Clean up global event listeners
      if (editorObj) {
        if (editorObj._windowClickHandler) {
          window.removeEventListener("click", editorObj._windowClickHandler);
        }
        if (editorObj._windowResizeHandler) {
          window.removeEventListener("resize", editorObj._windowResizeHandler);
        }

        // Drop this editor's entry so the shared provider stops answering for
        // a model that no longer exists.
        if (publishedKey) editorConfigs.delete(publishedKey);
        publishedKey = null;

        // Dispose the editor
        editorObj.dispose();
        editorObj = null;
      }
    });

    const enableCodeFolding = computed(() => {
      return ["json", "html", "javascript"].includes(props.language);
    });

    // update readonly when prop value changes
    watch(
      () => props.readOnly,
      () => {
        editorObj?.updateOptions({ readOnly: props.readOnly });
      },
    );

    // update lineNumbers when prop value changes
    watch(
      () => props.showLineNumbers,
      () => {
        editorObj?.updateOptions({
          lineNumbers: props.showLineNumbers ? "on" : "off",
        });
      },
    );

    watch(
      () => isDark.value,
      () => {
        if (!monaco) return;
        monaco.editor.setTheme(isDark.value ? "myCustomDarkTheme" : "myCustomTheme");
      },
    );

    // update readonly when prop value changes
    watch(
      () => props.query,
      () => {
        if (!editorObj) return;

        const currentValue = editorObj?.getValue();
        const newValue = props.query || "";
        const hasFocus = editorObj.hasWidgetFocus();

        // Only update if:
        // 1. Editor doesn't have focus (external update), OR
        // 2. It's readonly AND values are actually different
        // 3. Compare trimmed values to avoid cursor jumps from trailing spaces
        const shouldUpdate =
          (props.readOnly || !hasFocus) && currentValue?.trim() !== newValue?.trim();

        if (shouldUpdate) {
          editorObj.getModel()?.setValue(newValue);
        }
      },
    );

    const setValue = (value: string) => {
      if (editorObj?.setValue) {
        // Monaco's setValue throws "Illegal argument" for null/undefined —
        // coerce to a string so mode switches (e.g. PromQL → SQL) can't crash the editor
        editorObj.setValue(value ?? "");
        editorObj?.layout();
      }
    };

    /**
     * Register the provider set for a language exactly once.
     *
     * Each provider resolves the asking editor from the model, so three SQL
     * editors share one registration instead of stacking three.
     */
    const registerLanguageProviders = (language: string) => {
      if (!monaco || registeredLanguages.has(language)) return;
      registeredLanguages.add(language);
      const kinds = () => monaco.languages.CompletionItemKind;
      const rules = () => monaco.languages.CompletionItemInsertTextRule;

      monaco.languages.registerCompletionItemProvider(language, {
        // Without these nothing opens after a paren, a comma or an opening
        // quote — the positions where help is most wanted.
        triggerCharacters: [".", "(", ",", "'", '"', " "],
        provideCompletionItems: async (
          model: MonacoEditor.editor.ITextModel,
          position: MonacoEditor.Position,
        ) => {
          const config = editorConfigs.get(modelKey(model));
          if (!config || !config.enabled()) return { suggestions: [] };

          const textUntilPosition = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          // Field VALUES, resolved here rather than by the parent debouncing,
          // fetching, pushing a prop down and force-reopening the widget.
          const valueContext = parseValueContext(textUntilPosition);
          const resolver = config.resolveFieldValues();
          if (valueContext && resolver) {
            const values = await resolver(valueContext.field);
            if (values.length) {
              // Monaco auto-closes a typed quote, so the closer is already
              // sitting after the cursor — invisible to a parser that only sees
              // the text before it. Without this the insert produced
              // `level = 'error''`.
              const closingQuoteAhead =
                (model.getLineContent?.(position.lineNumber) ?? "").charAt(position.column - 1) ===
                "'";
              return {
                suggestions: buildCompletionItems({
                  keywords: buildValueEntries(values, {
                    hasOpenQuote: valueContext.hasOpenQuote,
                    closingQuoteAhead,
                    range,
                  }) as any[],
                  suggestions: [],
                  word: word.word,
                  range,
                  kinds: kinds(),
                  insertTextRules: rules(),
                  tags: monaco.languages.CompletionItemTag,
                }),
                incomplete: true,
              };
            }
          }

          // Inside avg( or approx_percentile_cont(, lift the numeric columns to
          // the top. On a metrics stream every label sorts above `value` — the
          // one column the function can take — which is a correct list and a
          // useless one. Applied to both lists so it does not depend on which
          // one a given host puts its fields in.
          const numericFirst = wantsNumericColumn(parseCallContext(textUntilPosition));
          const keywordList = numericFirst
            ? rankNumericFieldsFirst(config.keywords())
            : config.keywords();
          const suggestionList = numericFirst
            ? rankNumericFieldsFirst(config.suggestions())
            : config.suggestions();
          return {
            suggestions: buildCompletionItems({
              keywords: keywordList,
              suggestions: suggestionList,
              word: word.word,
              range,
              kinds: kinds(),
              insertTextRules: rules(),
              tags: monaco.languages.CompletionItemTag,
            }),
            // ALWAYS incomplete, which is not about the content: `severity = `
            // turns this same static catalog into a value list, and monaco
            // re-filters what it has unless the previous answer said otherwise
            // (suggestModel.js). So the values waited for a trigger character,
            // and a value fetched from the server after this call could never
            // arrive at all. Costs one provider call per keystroke over a local
            // catalog and a cached lookup.
            incomplete: true,
          };
        },
      });

      monaco.languages.registerSignatureHelpProvider(language, {
        signatureHelpTriggerCharacters: ["(", ","],
        signatureHelpRetriggerCharacters: [","],
        provideSignatureHelp: async (
          model: MonacoEditor.editor.ITextModel,
          position: MonacoEditor.Position,
        ) => {
          const config = editorConfigs.get(modelKey(model));
          if (!config || !config.enabled()) return null;

          const text = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });
          const call = parseCallContext(text);
          if (!call) return null;

          // The parser reports any identifier before the paren; the catalog
          // decides whether it is a function.
          const entry = findFunctionEntry(call.name, config.keywords(), config.suggestions());
          const value = buildSignatureHelp(entry as any, call.activeParameter);
          if (!value) return null;
          // monaco reads `.value` off a SignatureHelpResult and disposes it.
          return { value, dispose: () => {} };
        },
      });

      monaco.languages.registerHoverProvider(language, {
        provideHover: async (
          model: MonacoEditor.editor.ITextModel,
          position: MonacoEditor.Position,
        ) => {
          const config = editorConfigs.get(modelKey(model));
          if (!config || !config.enabled()) return null;

          const word = model.getWordAtPosition(position);
          if (!word?.word) return null;
          const entry = findCatalogEntry(word.word, config.keywords(), config.suggestions());
          const contents = buildHoverContents(t, entry as any);
          if (!contents) return null;
          return {
            contents,
            range: {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            },
          };
        },
      });
    };

    const resetEditorLayout = () => {
      editorObj?.layout();
    };

    const triggerAutoComplete = async (value: string) => {
      // Close any currently-open suggestion popup before retriggering.
      // Monaco's model.trigger() calls cancel() internally, but if a natural
      // popup is already in "Showing" state (e.g. opened by typing quote after
      // an operator, or from word-based suggest while typing NOT LIKE), the
      // widget may not refresh its item list. hideSuggestWidget transitions
      // state to Idle cleanly (no "user dismissed" flag) so the following
      // triggerSuggest always opens a fresh popup with the latest keywords.
      editorObj.trigger(value, "hideSuggestWidget", {});
      await nextTick();
      editorObj.trigger(value, "editor.action.triggerSuggest", {});
    };

    const disableSuggestionPopup = () => {
      // monaco's own command, which this file already uses elsewhere. The
      // synthetic Escape this replaced was a guess about monaco's internal key
      // handling that nothing verified, and it bubbled out of the editor to
      // anything else listening for Escape.
      editorObj?.trigger("disableSuggestionPopup", "hideSuggestWidget", {});
    };

    const formatDocument = async () => {
      // As Monaco editor does not support formatting in read-only mode, we need to temporarily disable it while formatting
      return new Promise((resolve) => {
        editorObj.updateOptions({ readOnly: false });
        editorObj
          .getAction("editor.action.formatDocument")
          .run()
          .then(() => {
            editorObj.updateOptions({ readOnly: props.readOnly });
            resolve(true);
          })
          .catch(() => {
            editorObj.updateOptions({ readOnly: props.readOnly });
            resolve(false);
          });
      });
    };

    const getCursorIndex = () => {
      const currentPosition = editorObj.getPosition();
      const cursorIndex = editorObj?.getModel().getOffsetAt(currentPosition) - 1;
      return cursorIndex || null;
    };

    const getModel = () => {
      return editorObj?.getModel();
    };

    const getValue = () => {
      return editorObj?.getValue();
    };

    const decorateRanges = (ranges: any[]) => {
      if (!monaco) return;
      // Highlight the ranges
      const decorations = ranges.map((range) => {
        return {
          range: new monaco.Range(range.startLine, 1, range.endLine, 1),
          options: {
            isWholeLine: true,
            className: "highlight-error", // Add this class to style the highlighted lines
            glyphMarginClassName: "error-glyph", // Optional: add a custom icon to the gutter
          },
        };
      });

      editorObj.deltaDecorations([], decorations);
    };

    function addErrorDiagnostics(ranges: any) {
      if (!monaco) return;
      // const markers = [
      //   {
      //     resource: {
      //       $mid: 1,
      //       external: "inmemory://model/4",
      //       path: "/4",
      //       scheme: "inmemory",
      //       authority: "model",
      //     },
      //     owner: "owner",
      //     code: "MY_ERROR_CODE",
      //     severity: monaco.MarkerSeverity.Error,
      //     message: "Error: Something went wrong",
      //     startLineNumber: 2,
      //     startColumn: 1,
      //     endLineNumber: 7,
      //     endColumn: 1,
      //   },
      //   {
      //     resource: {
      //       $mid: 1,
      //       external: "inmemory://model/4",
      //       path: "/4",
      //       scheme: "inmemory",
      //       authority: "model",
      //     },
      //     owner: "owner",
      //     code: "MY_ERROR_CODE",
      //     severity: monaco.MarkerSeverity.Error,
      //     message: "Error: Something went wrong",
      //     startLineNumber: 8,
      //     startColumn: 1,
      //     endLineNumber: 13,
      //     endColumn: 1,
      //   },
      // ];

      // Set markers to the model
      // monaco.editor.setModelMarkers(getModel(), "owner", markers);
      const model = getModel();
      const markers = ranges.map((range: any) => {
        const startLine = range.startLine;
        const endLine = range.endLine;
        const startCol = range.column ?? 1;
        // Prefer an explicit end column (wraps a single token — e.g. an unknown
        // field name). Otherwise highlight to end-of-line so a syntax-error
        // squiggle near the cursor stays visible.
        const lineContent = model?.getLineContent?.(endLine) ?? "";
        const endCol = range.endColumn ?? (lineContent.length + 1 || startCol + 1);
        return {
          severity: monaco.MarkerSeverity.Error,
          startLineNumber: startLine,
          startColumn: startCol,
          endLineNumber: endLine,
          endColumn: endCol,
          message: range.error,
          code: "",
        };
      });

      monaco.editor.setModelMarkers(getModel(), "owner", []);
      monaco.editor.setModelMarkers(getModel(), "owner", markers);
    }

    // Scan the current SQL query for double-quoted string values and mark them
    // with a warning squiggle + hover tooltip. Double quotes are only valid for
    // identifiers (table/column names) in SQL; string literals must use single
    // quotes. Operates independently of addErrorDiagnostics ("owner" markers) so
    // server-side error markers and these client-side warnings never interfere.
    const validateDoubleQuotes = () => {
      if (!editorObj || !monaco || props.language !== "sql") return;
      const model = editorObj.getModel();
      if (!model) return;

      // Deciding WHAT is wrong lives in utils/query/doubleQuoteWarnings.ts,
      // where it is comment- and string-aware and can be tested without an
      // editor. What is left here is the monaco half: offsets to positions,
      // positions to markers.
      const text = model.getValue();
      const markers = findDoubleQuoteIssues(t, text).map((issue) => {
        const startPos = model.getPositionAt(issue.startOffset);
        const endPos = model.getPositionAt(issue.endOffset);
        return {
          severity: monaco.MarkerSeverity.Warning,
          startLineNumber: startPos.lineNumber,
          startColumn: startPos.column,
          endLineNumber: endPos.lineNumber,
          endColumn: endPos.column,
          message: issue.message,
        };
      });

      monaco.editor.setModelMarkers(model, "dq-validation", markers);
    };

    // Watch isGenerating and emit events to parent
    watch(isGenerating, (newValue) => {
      if (newValue) {
        emit("generation-start");
      } else {
        emit("generation-end");
      }
    });

    // Computed property for AI icon based on theme
    const aiIcon = computed(() => {
      return isDark.value
        ? getImageURL("images/common/ai_icon_dark.svg")
        : getImageURL("images/common/ai_icon_gradient.svg");
    });

    // Toggle NLP mode
    const toggleNlpMode = () => {
      emit("toggle-nlp-mode");
    };

    return {
      editorRef,
      // `editorObj` is reassigned by a plain closure variable (monaco.editor.create
      // runs after mount), so exposing it directly here would freeze callers to
      // whatever it was at setup() return time (null, since the editor hasn't
      // mounted yet). Expose a getter instead so external callers (see
      // ContentTemplateForm.vue's toolbar actions) always read the live instance.
      get editorObj() {
        return editorObj;
      },
      setValue,
      resetEditorLayout,
      disableSuggestionPopup,
      triggerAutoComplete,
      getCursorIndex,
      searchObj,
      formatDocument,
      getModel,
      getValue,
      decorateRanges,
      addErrorDiagnostics,
      isGenerating,
      handleGenerateSQL,
      streamingResponse,
      t,
      aiIcon,
      toggleNlpMode,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override:monaco) — every rule below targets Monaco's own generated DOM
   (.monaco-editor, .suggest-widget, and decoration classes injected via the
   decorations API). These nodes are created by the library at runtime and never
   carry the scoped data-v attribute, so they are unreachable from utilities and
   must stay as :deep() CSS. */

.logs-query-editor :deep(.monaco-editor),
.logs-query-editor :deep(.monaco-editor .monaco-editor) {
  padding: 0 !important;
  --vscode-focusBorder: transparent !important;
}

/* Neutralise monaco's stray focus outline / focus-border on the mount, the real
   inner editor, the overflow guard and the hidden focus textarea. The last three
   are monaco-generated DOM. */
.logs-query-editor,
.logs-query-editor :deep(.monaco-editor),
.logs-query-editor :deep(.overflow-guard),
.logs-query-editor :deep(.inputarea) {
  outline: none !important;
  --vscode-focusBorder: transparent !important;
}

.logs-query-editor :deep(.monaco-editor .editor-widget .suggest-widget),
.logs-query-editor :deep(.monaco-editor .monaco-editor .editor-widget .suggest-widget) {
  z-index: 9999;
  display: flex !important;
  visibility: visible !important;
}

/* Monaco sizes the suggest documentation panel with
   `layout(width, type.clientHeight + docs.clientHeight)` and assigns that height
   to THIS element (suggestWidgetDetails.js:161) — arithmetic that assumes
   content-box. The app's global reset makes everything border-box, so the
   panel's own hairline top and bottom borders eat two pixels of the content it
   just measured, and the documentation scrolls by that sliver every time.
   Restoring content-box for this one node is less fragile than trying to
   out-compute the library. */
.logs-query-editor :deep(.suggest-details) {
  box-sizing: content-box;
}

/* Error decoration — class name is handed to monaco.deltaDecorations(), so the
   element only ever exists inside Monaco's view-lines. */
.logs-query-editor :deep(.highlight-error) {
  background-color: color-mix(in srgb, var(--color-status-negative) 10%, transparent);
  text-decoration: underline;
  text-decoration-color: var(--color-status-negative);
}

/* PromQL brackets render plain (like Prometheus). The rainbow colours are
   theme-global and the disable option doesn't strip these classes — repaint. */
.logs-query-editor.promql-mode :deep(.bracket-highlighting-0),
.logs-query-editor.promql-mode :deep(.bracket-highlighting-1),
.logs-query-editor.promql-mode :deep(.bracket-highlighting-2),
.logs-query-editor.promql-mode :deep(.bracket-highlighting-3),
.logs-query-editor.promql-mode :deep(.bracket-highlighting-4),
.logs-query-editor.promql-mode :deep(.bracket-highlighting-5),
.logs-query-editor.promql-mode :deep(.bracket-highlighting-6) {
  color: var(--vscode-editor-foreground, var(--color-text-body)) !important;
}
</style>
