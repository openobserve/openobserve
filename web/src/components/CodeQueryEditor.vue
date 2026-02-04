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

<template>
  <div class="code-query-editor-container">
    <div
      data-test="query-editor"
      class="logs-query-editor"
      ref="editorRef"
      :id="editorId"
    />
    <!-- Streaming response preview card (shown while generating) -->
    <Transition name="slide-up">
      <div
        v-if="isGenerating && streamingResponse"
        class="streaming-preview-card"
        data-test="nl-streaming-preview"
      >
        <pre class="streaming-preview-content">{{ streamingResponse }}</pre>
      </div>
    </Transition>
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

// Lazy load Monaco Editor - only loaded when this component is rendered
// This reduces initial bundle size by ~3.1MB
let monaco: any = null;
const loadMonaco = async () => {
  if (!monaco) {
    await import("monaco-editor/esm/vs/editor/editor.all.js");
    monaco = await import("monaco-editor/esm/vs/editor/editor.api");
  }
  return monaco;
};

import { vrlLanguageDefinition } from "@/utils/query/vrlLanguageDefinition";

import { useStore } from "vuex";
import { debounce } from "quasar";
import searchState from "@/composables/useLogs/searchState";
import { useNLQuery } from "@/composables/useNLQuery";
import { useI18n } from "vue-i18n";
import useNotifications from "@/composables/useNotifications";

export default defineComponent({
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
      default: () => [],
    },
    debounceTime: {
      type: Number,
      default: 500,
    },
    readOnly: {
      type: Boolean,
      default: false,
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
  },
  emits: ["update-query", "run-query", "update:query", "focus", "blur", "nlp-mode-detected", "nlpModeDetected"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const { showErrorNotification } = useNotifications();
    const editorRef: any = ref();
    // editor object is used to interact with the monaco editor instance
    let editorObj: any = null;
    const { searchObj } = searchState();
    const { detectNaturalLanguage, generateSQL, transformToSQL, isGenerating, streamingResponse } = useNLQuery();

    let provider: Ref<any | null> = ref(null);
    const currentEditorText = ref('');

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
        label: (_keyword: string) =>
          `re_match(fieldname: string, regular_expression: string)`,
        kind: "Text",
        insertText: (_keyword: string) => `re_match(fieldname, '')`,
      },
      {
        label: (_keyword: string) =>
          `re_not_match(fieldname: string, regular_expression: string)`,
        kind: "Text",
        insertText: (_keyword: string) => `re_not_match(fieldname, '')`,
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
      {
        label: (_keyword: string) => `fuzzy_match(fieldname, '${_keyword}', 1)`,
        kind: "Text",
        insertText: (_keyword: string) =>
          `fuzzy_match(fieldname, '${_keyword}', 1)`,
      },
      {
        label: (_keyword: string) => `fuzzy_match_all('${_keyword}', 1)`,
        kind: "Text",
        insertText: (_keyword: string) => `fuzzy_match_all('${_keyword}', 1)`,
      },
    ];

    watch(
      () => store.state.theme,
      () => {
        if (!monaco) return;
        monaco.editor.setTheme(
          store.state.theme == "dark" ? "vs-dark" : "myCustomTheme",
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
      if (props.language === "sql" && !props.suggestions?.length) {
        return defaultSuggestions;
      }
      return props.suggestions;
    });

    /**
     * Debounced function to detect natural language and show/hide button
     * Waits 500ms after user stops typing before checking
     * Only shows button if: (1) text is natural language AND (2) stream is selected
     */
    const checkForNaturalLanguage = debounce((text: string) => {
      currentEditorText.value = text;
      const isNL = detectNaturalLanguage(text);

      console.log('[NL2Q-Detection]', {
        text: text.substring(0, 50),
        isNaturalLanguage: isNL
      });

      // Emit event to auto-toggle NLP mode when natural language is detected
      // The parent component (SearchBar) will handle toggling the NLP mode
      if (isNL) {
        console.log('[NL2Q-Detection] Emitting nlp-mode-detected event');
        emit("nlp-mode-detected", true);
        emit("nlpModeDetected", true); // Also emit camelCase version
        console.log('[NL2Q-Detection] Event emitted successfully (both kebab and camel case)');
      } else {
        console.log('[NL2Q-Detection] Not natural language, not emitting event');
      }
    }, 500);

    /**
     * Handles Generate SQL button click
     * Calls AI to generate SQL and transforms editor content
     */
    const handleGenerateSQL = async () => {
      const currentText = currentEditorText.value;
      if (!currentText.trim()) return;

      console.log('[NL2Q-UI] Starting SQL generation for:', currentText);

      try {
        // Get organization ID from store
        const orgId = store.state.selectedOrganization?.identifier || 'default';
        console.log('[NL2Q-UI] Organization ID:', orgId);

        // Prefix the natural language text with instruction for AI
        const prompt = `Generate SQL query : ${currentText}`;

        // Generate SQL from natural language
        console.log('[NL2Q-UI] Calling generateSQL...');
        const generatedSQL = await generateSQL(prompt, orgId);
        console.log('[NL2Q-UI] generateSQL returned:', {
          value: generatedSQL,
          type: typeof generatedSQL,
          isNull: generatedSQL === null,
          isEmpty: generatedSQL === '',
          isFalsy: !generatedSQL
        });

        if (!generatedSQL || generatedSQL.trim() === '') {
          // Show error notification
          console.log('[NL2Q-UI] Showing error notification - query generation failed or empty');
          showErrorNotification(t('search.nlQueryGenerationFailed'));
          return;
        }

        // Transform: NL becomes comment, SQL appears below
        const transformedText = transformToSQL(currentText, generatedSQL);
        console.log('[NL2Q-UI] Transformed text:', transformedText);

        // Update editor value
        setValue(transformedText);

        // Emit update events
        emit("update-query", transformedText);
        emit("update:query", transformedText);

        // Turn off NLP mode after generating SQL (we're now in SQL mode)
        emit("nlp-mode-detected", false);
        emit("nlpModeDetected", false);
        console.log('[NL2Q-UI] Emitted nlpModeDetected: false to turn off NLP mode');

        console.log('[NL2Q-UI] SQL generation completed successfully');

      } catch (error) {
        console.error('[NL2Q-UI] Exception during SQL generation:', error);
        showErrorNotification(t('search.nlQueryGenerationFailed'));
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
          const currentValue = editorObj.getValue();
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
          editorElement.innerHTML = '';
          // Fall through to create new editor below
        }
      }
      editorObj = monaco.editor.create(editorElement as HTMLElement, {
        value: props.query?.trim(),
        language: props.language,
        theme: store.state.theme == "dark" ? "vs-dark" : "myCustomTheme",
        showFoldingControls: enableCodeFolding.value ? "always" : "never",
        folding: enableCodeFolding.value,
        wordWrap: "on",
        automaticLayout: true,
        lineNumbers: "on",
        lineNumbersMinChars: 0,
        overviewRulerLanes: 0,
        fixedOverflowWidgets: true,
        overviewRulerBorder: false,
        lineDecorationsWidth: 3,
        hideCursorInOverviewRuler: true,
        renderLineHighlight: "none",
        glyphMargin: false,
        scrollBeyondLastColumn: 0,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        mouseWheelScrollSensitivity: 1,
        fastScrollSensitivity: 1,
        scrollbar: { horizontal: "auto", vertical: "visible" },
        find: {
          addExtraSpaceOnTop: false,
          autoFindInSelection: "never",
          seedSearchStringFromSelection: "never",
        },
        minimap: { enabled: false },
        readOnly: props.readOnly,
        renderValidationDecorations: "on",
      });

      editorObj.onDidChangeModelContent(
        debounce((e: any) => {
          const newValue = editorObj.getValue()?.trim();
          emit("update-query", newValue, e);
          emit("update:query", newValue, e);

          // Check for natural language after user stops typing (debounced)
          checkForNaturalLanguage(newValue);
        }, props.debounceTime),
      );

      editorObj.createContextKey("ctrlenter", true);
      editorObj.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        function () {
          //this is because to not trigger the cmnd + enter and to avoid the blank space while cmd + enter
        },
        "ctrlenter",
      );
      editorObj.onDidFocusEditorWidget(() => {
        emit("focus");
      });

      editorObj.onDidBlurEditorWidget(() => {
        const model = editorObj.getModel();
        const value = model.getValue();
        const trimmedValue = value.trim();

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
    };

    onMounted(async () => {
      provider.value?.dispose();

      if (props.language === "sql") {
        await import(
          "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js"
        );
      }

      if (props.language === "json") {
        await import(
          "monaco-editor/esm/vs/language/json/monaco.contribution.js"
        );
      }

      if (props.language === "html") {
        await import(
          "monaco-editor/esm/vs/language/html/monaco.contribution.js"
        );
      }

      if (props.language === "markdown") {
        await import(
          "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js"
        );
      }

      if (props.language === "python") {
        await import(
          "monaco-editor/esm/vs/basic-languages/python/python.contribution.js"
        );
      }
      if (props.language === "javascript") {
        await import(
          "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js"
        );
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

    watch(
      () => store.state.theme,
      () => {
        if (!monaco) return;
        monaco.editor.setTheme(
          store.state.theme == "dark" ? "vs-dark" : "myCustomTheme",
        );
      },
    );

    // update readonly when prop value changes
    watch(
      () => props.query,
      (newQuery, oldQuery) => {
        if (props.readOnly || !editorObj?.hasWidgetFocus()) {
          editorObj?.getModel()?.setValue(props.query);
        }
      },
    );

    const setValue = (value: string) => {
      if (editorObj?.setValue) {
        editorObj.setValue(value);
        editorObj?.layout();
      }
    };

    const registerAutoCompleteProvider = () => {
      if (!props.showAutoComplete || !monaco) return;
      provider.value = monaco.languages.registerCompletionItemProvider(
        props.language,
        {
          provideCompletionItems: function (model, position) {
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
      disableSuggestionPopup();
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

      const decorationIds = editorObj.deltaDecorations([], decorations);
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
      const markers = ranges.map((range: any) => ({
        severity: monaco.MarkerSeverity.Error, // Mark as error
        startLineNumber: range.startLine,
        startColumn: 1, // Start of the line
        endLineNumber: range.endLine,
        endColumn: 1, // End of the line
        message: range.error, // The error message
        code: "", // Optional error code
      }));

      monaco.editor.setModelMarkers(getModel(), "owner", []);
      monaco.editor.setModelMarkers(getModel(), "owner", markers);
    }

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
    };
  },
});
</script>

<style scoped>
#editor {
  width: 100%;
  height: 78%;
  border-radius: 5px;
}

.code-query-editor-container {
  position: relative;
  width: 100%;
  height: 100%;
}

/* Generate SQL button - O2 AI Assistant gradient style (matches send-button) */
.generate-sql-button {
  position: absolute;
  bottom: 0.5rem;
  right: 0.5rem;
  z-index: 100;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  color: white !important;
  box-shadow: 0 0.25rem 0.9375rem 0 rgba(102, 126, 234, 0.3) !important;
  transition: all 0.3s ease !important;
  border: none !important;
}

.generate-sql-button:hover:not(.disabled):not([disabled]):not(:disabled) {
  background: linear-gradient(135deg, #5a6fd8 0%, #6a4190 100%) !important;
  box-shadow: 0 0.375rem 1.25rem 0 rgba(102, 126, 234, 0.4) !important;
  transform: translateY(-0.0625rem) !important;
}

.generate-sql-button:active:not(.disabled):not([disabled]):not(:disabled) {
  transform: translateY(0) !important;
  box-shadow: 0 0.125rem 0.625rem 0 rgba(102, 126, 234, 0.3) !important;
}

/* Fade transition for button appearance */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Streaming preview card - O2 AI Assistant message style with purple border */
.streaming-preview-card {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 56.25rem; /* 900px - matches O2 AI Assistant max-width */
  max-width: calc(100% - 2rem);
  max-height: 31.25rem;
  background: var(--o2-card-bg);
  border-radius: 0.5rem; /* 8px - matches O2 message border-radius */
  border: 2px solid #667eea; /* O2 AI Assistant purple border */
  padding: 0.75rem; /* 12px - matches O2 message padding */
  z-index: 99;
  overflow: hidden;
}

/* Light mode shadow - matches O2 AI Assistant with purple glow */
.light-mode .streaming-preview-card {
  box-shadow: 0 0.25rem 1rem 0 rgba(102, 126, 234, 0.2);
}

/* Dark mode shadow - matches O2 AI Assistant with purple glow */
.dark-mode .streaming-preview-card {
  box-shadow: 0 0.25rem 1rem 0 rgba(102, 126, 234, 0.3);
}

/* Streaming preview content - O2 AI Assistant text-block style with center alignment */
.streaming-preview-content {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 0.875rem;
  line-height: 1.6; /* Better readability for text content */
  color: var(--o2-text-primary);
  margin: 0;
  padding: 0.5rem;
  text-align: center; /* Center-aligned text */
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
  word-break: break-word;
  overflow-y: auto;
  max-height: 30rem;
  max-width: 100%;
}

/* Code blocks within streaming preview */
.streaming-preview-content :deep(pre),
.streaming-preview-content :deep(code) {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Courier New', monospace;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  line-height: 1.4;
  padding: 0.5rem;
  margin: 0.25rem 0;
  border-radius: 0.25rem;
  display: block;
  max-width: 100%;
  overflow-x: auto;
}

/* Lists within streaming preview */
.streaming-preview-content :deep(ol) {
  list-style-type: decimal;
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.streaming-preview-content :deep(ul) {
  list-style-type: disc;
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.streaming-preview-content :deep(li) {
  margin: 0.25em 0;
}

/* Paragraphs within streaming preview */
.streaming-preview-content :deep(p) {
  margin: 0.5em 0;
  word-wrap: break-word;
  overflow-wrap: break-word;
  word-break: break-word;
  max-width: 100%;
}

/* Slide up transition for streaming preview - centered */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.95);
}

.slide-up-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.98);
}

@keyframes typing-cursor {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.85;
  }
}
</style>

<style lang="scss">
.logs-query-editor {
  .monaco-editor,
  .monaco-editor .monaco-editor {
    padding: 0px 0px 0px 0px !important;

    .editor-widget .suggest-widget {
      z-index: 9999;
      display: flex !important;
      visibility: visible !important;
    }
  }
  --vscode-focusBorder: transparent !important;
}

.highlight-error {
  background-color: rgba(255, 0, 0, 0.1);
  text-decoration: underline;
  text-decoration-color: red;
}
</style>
