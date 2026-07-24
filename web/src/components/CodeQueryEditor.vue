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
  <div class="relative w-full h-full flex flex-col" v-bind="$attrs">
    <div
      data-test="query-editor"
      class="logs-query-editor flex-1 min-h-0 bg-card-glass-bg"
      ref="editorRef"
      :id="editorId"
    />
    <!-- AI Icon Button -->
    <OButton
      v-if="showAiIcon && !disableAi"
      variant="sidebar-toggle"
      size="icon-toolbar"
      class="absolute! top-2 right-2 z-10 bg-card-glass-bg border border-card-glass-border transition-all duration-200 hover:bg-button-outline-hover-bg hover:border-accent"
      :class="nlpMode ? 'bg-primary-100 border-accent' : ''"
      @click="toggleNlpMode"
      data-test="query-editor-ai-icon-btn"
    >
      <!-- name="" satisfies the required prop; empty name renders only the slot -->
      <OIcon name="" size="md">
        <img :src="aiIcon" :alt="t('search.aiIconAlt')" class="w-4.5 h-4.5" />
      </OIcon>
      <OTooltip side="top" align="center">
        <template #content>{{ disableAiReason || t(nlpMode ? 'search.nlpModeEnabled' : 'search.nlpModeLabel') }}</template>
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
  type Ref,
  onDeactivated,
  onUnmounted,
  onActivated,
  watch,
  computed,
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

import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { debounce } from "lodash-es";
import searchState from "@/composables/useLogs/searchState";
import { useNLQuery } from "@/composables/useNLQuery";
import { useI18n } from "vue-i18n";
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
      type: String,
      default: "",
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
    const { t } = useI18n();
    const { showErrorNotification } = useNotifications();
    const editorRef: any = ref();
    let editorObj: any = null;
    // Emits the editor's content immediately instead of waiting out the change
    // debounce. Assigned when the editor is created; see `commitModelChange`.
    let commitPendingChange: (() => void) | null = null;
    const { searchObj } = searchState();
    const {
      detectNaturalLanguage,
      generateSQL,
      transformToSQL,
      isGenerating,
      streamingResponse,
    } = useNLQuery();

    let provider: Ref<any | null> = ref(null);
    const currentEditorText = ref("");

    // These will be initialized when Monaco loads
    let CompletionKind: any = null;
    let insertTextRules: any = null;

    const initializeMonacoConstants = () => {
      if (!monaco || CompletionKind) return;

      CompletionKind = {
        Keyword: monaco.languages.CompletionItemKind.Keyword,
        Operator: monaco.languages.CompletionItemKind.Operator,
        Text: monaco.languages.CompletionItemKind.Text,
        Value: monaco.languages.CompletionItemKind.Value,
        Method: monaco.languages.CompletionItemKind.Method,
        Function: monaco.languages.CompletionItemKind.Function,
        Constructor: monaco.languages.CompletionItemKind.Constructor,
        Field: monaco.languages.CompletionItemKind.Field,
        Variable: monaco.languages.CompletionItemKind.Variable,
      };

      insertTextRules = {
        InsertAsSnippet:
          monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        KeepWhitespace:
          monaco.languages.CompletionItemInsertTextRule.KeepWhitespace,
        None: monaco.languages.CompletionItemInsertTextRule.None,
      };
    };

    const defaultKeywords = [
      {
        label: "and",
        kind: "Keyword",
        insertText: "and ",
      },
      {
        label: "or",
        kind: "Keyword",
        insertText: "or ",
      },
      {
        label: "like",
        kind: "Keyword",
        insertText: "like '%${1:params}%' ",
        insertTextRules: "InsertAsSnippet",
      },
      {
        label: "in",
        kind: "Keyword",
        insertText: "in ('${1:params}') ",
        insertTextRules: "InsertAsSnippet",
      },
      {
        label: "not in",
        kind: "Keyword",
        insertText: "not in ('${1:params}') ",
        insertTextRules: "InsertAsSnippet",
      },
      {
        label: "between",
        kind: "Keyword",
        insertText: "between '${1:params}' and '${1:params}' ",
        insertTextRules: "InsertAsSnippet",
      },
      {
        label: "not between",
        kind: "Keyword",
        insertText: "not between '${1:params}' and '${1:params}' ",
        insertTextRules: "InsertAsSnippet",
      },
      {
        label: "is null",
        kind: "Keyword",
        insertText: "is null ",
      },
      {
        label: "is not null",
        kind: "Keyword",
        insertText: "is not null ",
      },
      {
        label: ">",
        kind: "Operator",
        insertText: "> ",
      },
      {
        label: "<",
        kind: "Operator",
        insertText: "< ",
      },
      {
        label: ">=",
        kind: "Operator",
        insertText: ">= ",
      },
      {
        label: "<=",
        kind: "Operator",
        insertText: "<= ",
      },
      {
        label: "<>",
        kind: "Operator",
        insertText: "<> ",
      },
      {
        label: "=",
        kind: "Operator",
        insertText: "= ",
      },
      {
        label: "!=",
        kind: "Operator",
        insertText: "!= ",
      },
      {
        label: "()",
        kind: "Keyword",
        insertText: "(${1:condition}) ",
        insertTextRules: "InsertAsSnippet",
      },
    ];
    const defaultSuggestions = [
      {
        label: (_keyword: string) => `match_all('${_keyword}')`,
        kind: "Text",
        insertText: (_keyword: string) => `match_all('${_keyword}')`,
      },
      {
        label: (_keyword: string) => `match_all_raw('${_keyword}')`,
        kind: "Text",
        insertText: (_keyword: string) => `match_all_raw('${_keyword}')`,
      },
      {
        label: (_keyword: string) => `match_all_raw_ignore_case('${_keyword}')`,
        kind: "Text",
        insertText: (_keyword: string) =>
          `match_all_raw_ignore_case('${_keyword}')`,
      },
      {
        label: () =>
          `re_match(fieldname: string, regular_expression: string)`,
        kind: "Text",
        insertText: () => `re_match(fieldname, '')`,
      },
      {
        label: () =>
          `re_not_match(fieldname: string, regular_expression: string)`,
        kind: "Text",
        insertText: () => `re_not_match(fieldname, '')`,
      },
      {
        label: (_keyword: string) => `str_match(fieldname, '${_keyword}')`,
        kind: "Text",
        insertText: (_keyword: string) => `str_match(fieldname, '${_keyword}')`,
      },
      {
        label: (_keyword: string) =>
          `str_match_ignore_case(fieldname, '${_keyword}')`,
        kind: "Text",
        insertText: (_keyword: string) =>
          `str_match_ignore_case(fieldname, '${_keyword}')`,
      },
    ];

    watch(
      () => isDark.value,
      () => {
        if (!monaco) return;
        monaco.editor.setTheme(
          isDark.value ? "myCustomDarkTheme" : "myCustomTheme",
        );
      },
    );

    const keywords = computed(() => {
      if (props.language === "sql" && !props.keywords?.length) {
        return defaultKeywords;
      }
      return props.keywords;
    });

    const suggestions = computed(() => {
      if (props.language === "sql" && props.suggestions == null) {
        return defaultSuggestions;
      }
      return props.suggestions ?? [];
    });

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
        const generatedSQL = await generateSQL(
          prompt,
          orgId,
          abortSignal,
          sessionId,
        );

        if (!generatedSQL || generatedSQL.trim() === "") {
          // Show error notification - use streaming error message if available (e.g. Unauthorized Access)
          const errorMsg = isAuthError(streamingResponse.value)
            ? streamingResponse.value
            : t("search.nlQueryGenerationFailed");
          showErrorNotification(errorMsg);
          if (isAuthError(streamingResponse.value)) {
            return; // Auth error already handled, don't trigger catch block
          }
          throw new Error("Query generation failed");
        }

        // Check if this is a special action completion (dashboard/alert)
        if (generatedSQL.startsWith("✓ DASHBOARD_CREATED:")) {
          const responseText = generatedSQL
            .replace("✓ DASHBOARD_CREATED:", "")
            .trim();
          emit("generation-success", {
            type: "dashboard",
            message: responseText,
          });
          // Don't emit nlpModeDetected - keep user in current mode
          return; // Success without SQL
        }

        if (generatedSQL.startsWith("✓ ALERT_CREATED:")) {
          const responseText = generatedSQL
            .replace("✓ ALERT_CREATED:", "")
            .trim();
          emit("generation-success", { type: "alert", message: responseText });
          // Don't emit nlpModeDetected - keep user in current mode
          return; // Success without SQL
        }

        if (generatedSQL.startsWith("✓ ACTION_COMPLETED:")) {
          const responseText = generatedSQL
            .replace("✓ ACTION_COMPLETED:", "")
            .trim();
          emit("generation-success", { type: "action", message: responseText });
          // Don't emit nlpModeDetected - keep user in current mode
          return; // Success without SQL
        }

        // Normal query generation - transform and update editor with language-specific comments
        const transformedText = transformToSQL(
          currentText,
          generatedSQL,
          props.language,
        );

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

    const createDependencyProposals = (range: any) => {
      if (!CompletionKind || !insertTextRules) return [];
      return keywords.value.map((keyword: any) => {
        const itemObj: any = {
          ...keyword,
          label: keyword["label"],
          kind: CompletionKind[keyword["kind"]],
          insertText: keyword["insertText"],
          range: range,
        };
        if (insertTextRules[keyword["insertTextRule"]]) {
          itemObj["insertTextRules"] =
            insertTextRules[keyword["insertTextRule"]];
        }
        return itemObj;
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

      // Initialize Monaco constants after loading
      initializeMonacoConstants();

      // Register custom languages after Monaco is loaded
      if (props.language === "promql") {
        monaco.languages.register({ id: "promql" });
      }
      if (props.language === "vrl") {
        monaco.languages.register({ id: "vrl" });

        // Register a tokens provider for the language
        monaco.languages.setMonarchTokensProvider(
          "vrl",
          vrlLanguageDefinition as any,
        );
      }

      monaco.editor.defineTheme("myCustomTheme", {
        base: "vs", // can also be vs-dark or hc-black
        inherit: true, // can also be false to completely replace the builtin rules
        rules: [{ token: "comment", background: "FFFFFF" }],
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
        ],
        colors: {},
      });

      // Dispose the provider if it already exists before registering a new one
      provider.value?.dispose();
      registerAutoCompleteProvider();

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
        stickyScroll: {
          enabled: props.stickyScroll,
        },
      });

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
      editorObj.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        runQuery,
        "ctrlenter",
      );
      editorObj.onDidFocusEditorWidget(() => {
        emit("focus");

        // added hack to handle case where ctrl+enter / cmd+enter stops working after
        // user click on the result row and open sidebase or opensidebar from schedule search
        // This is because the editor loses focus and the context key "ctrlenter" is not active anymore, so we need to re-add the command on focus
        editorObj.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
          runQuery,
          "ctrlenter",
        );
      });

      editorObj.onDidBlurEditorWidget(() => {
        const model = editorObj?.getModel();
        const value = model?.getValue();
        const trimmedValue = value?.trim();

        // Only apply trim if there are actually tailing and leading spaces to trim
        if (value !== trimmedValue) {
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

    onMounted(async () => {
      provider.value?.dispose();

      if (props.language === "sql") {
        await import("monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js");
      }

      if (props.language === "json") {
        await import("monaco-editor/esm/vs/language/json/monaco.contribution.js");
      }

      if (props.language === "html") {
        await import("monaco-editor/esm/vs/language/html/monaco.contribution.js");
      }

      if (props.language === "markdown") {
        await import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js");
      }

      if (props.language === "python") {
        await import("monaco-editor/esm/vs/basic-languages/python/python.contribution.js");
      }
      if (props.language === "javascript") {
        await import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js");
      }

      setupEditor();
    });

    onActivated(async () => {
      if (!editorObj) {
        setupEditor();
        editorObj?.layout();
      } else {
        provider.value?.dispose();
        registerAutoCompleteProvider();
      }
    });

    onDeactivated(() => {
      provider.value?.dispose();
    });

    onUnmounted(() => {
      provider.value?.dispose();

      // Clean up global event listeners
      if (editorObj) {
        if (editorObj._windowClickHandler) {
          window.removeEventListener("click", editorObj._windowClickHandler);
        }
        if (editorObj._windowResizeHandler) {
          window.removeEventListener("resize", editorObj._windowResizeHandler);
        }

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
        monaco.editor.setTheme(
          isDark.value ? "myCustomDarkTheme" : "myCustomTheme",
        );
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
          (props.readOnly || !hasFocus) &&
          currentValue?.trim() !== newValue?.trim();

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

    const registerAutoCompleteProvider = () => {
      if (!props.showAutoComplete || !monaco) return;
      provider.value = monaco.languages.registerCompletionItemProvider(
        props.language,
        {
          provideCompletionItems: function (
            model: MonacoEditor.editor.ITextModel,
            position: MonacoEditor.Position,
          ) {
            // find out if we are completing a property in the 'dependencies' object.
            var textUntilPosition = model.getValueInRange({
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            });

            var word = model.getWordUntilPosition(position);
            var range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            };

            let arr = textUntilPosition.trim().split(" ");
            let filteredSuggestions = [];
            filteredSuggestions = createDependencyProposals(range);
            filteredSuggestions = filteredSuggestions.filter((item) => {
              return item.label.toLowerCase().includes(word.word.toLowerCase());
            });

            const lastElement = arr.pop();
            suggestions.value.forEach((suggestion: any) => {
              filteredSuggestions.push({
                label: suggestion.label(lastElement),
                kind: monaco.languages.CompletionItemKind[
                  suggestion.kind || "Text"
                ],
                insertText: suggestion.insertText(lastElement),
                range: range,
              });
            });

            return {
              suggestions: filteredSuggestions,
            };
          },
        },
      );
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
      const escEvent = new KeyboardEvent("keydown", {
        keyCode: 27,
        code: "Escape",
        key: "Escape",
        bubbles: true,
      });
      editorRef.value.dispatchEvent(escEvent);
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
      const cursorIndex =
        editorObj?.getModel().getOffsetAt(currentPosition) - 1;
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
        const endCol =
          range.endColumn ?? (lineContent.length + 1 || startCol + 1);
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

      const text = model.getValue();
      const markers: any[] = [];

      // Two patterns are flagged — both only within value position (after a
      // SQL comparison/membership operator). FROM "table" / SELECT "col" are
      // intentionally NOT matched.
      //
      //  Pattern A — fully double-quoted:  field = "value"
      //  Pattern B — mismatched quotes:    field = "value'  or  field = 'value"
      //    Capture group 1: the invalid quoted token
      const regex =
        /(?:NOT\s+LIKE|NOT\s+IN\s*\(|!=|<>|>=|<=|=|>|<|LIKE|IN\s*\()\s*("[^'"]*'|'[^'"]*"|"[^"]*")/gi;

      let match;
      while ((match = regex.exec(text)) !== null) {
        const quotedStr = match[1]; // the invalid quoted token
        const startOffset = match.index + match[0].length - quotedStr.length;
        const endOffset = startOffset + quotedStr.length;

        const startPos = model.getPositionAt(startOffset);
        const endPos = model.getPositionAt(endOffset);

        const isMixed =
          (quotedStr.startsWith('"') && quotedStr.endsWith("'")) ||
          (quotedStr.startsWith("'") && quotedStr.endsWith('"'));

        markers.push({
          severity: monaco.MarkerSeverity.Warning,
          startLineNumber: startPos.lineNumber,
          startColumn: startPos.column,
          endLineNumber: endPos.lineNumber,
          endColumn: endPos.column,
          message: isMixed
            ? "Mismatched quotes. Use matching single quotes for string values."
            : "Double quotes are not valid for string values. Use single quotes instead.",
        });
      }

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
      editorObj,
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

/* Error decoration — class name is handed to monaco.deltaDecorations(), so the
   element only ever exists inside Monaco's view-lines. */
.logs-query-editor :deep(.highlight-error) {
  background-color: color-mix(in srgb, var(--color-status-negative) 10%, transparent);
  text-decoration: underline;
  text-decoration-color: var(--color-status-negative);
}
</style>
