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
  <div
    data-test="query-editor"
    class="logs-query-editor"
    :class="[store.state.theme === 'dark' ? 'theme-dark' : 'theme-light']"
    ref="editorRef"
    :id="editorId"
  />
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

import { EditorView, basicSetup, minimalSetup } from "codemirror";
import { EditorState, Compartment, StateEffect, StateField } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";

import {
  autocompletion,
  CompletionContext,
  Completion,
  closeBrackets,
  closeBracketsKeymap,
  startCompletion,
  closeCompletion,
} from "@codemirror/autocomplete";

import { keymap, lineNumbers, showTooltip, Tooltip } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { o2QueryEditorDarkTheme } from "@/components/CodeQueryEditorDarkTheme";
import { o2QueryEditorLightTheme } from "@/components/CodeQueryEditorLightTheme";
import { vrlLanguageDefinition } from "@/utils/query/vrlLanguageDefinition";

import {
  searchKeymap,
  highlightSelectionMatches,
  search,
} from "@codemirror/search";

import { useStore } from "vuex";
import { debounce } from "quasar";

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
      default: 300,
    },
    readOnly: {
      type: Boolean,
      default: false,
    },
    language: {
      type: String,
      default: "sql",
    },
    autoComplete: {
      type: Object,
      default: () => ({
        showEmpty: false,
        selectOnOpen: false,
        filterStrict: false,
        filter: false,
      }),
    },
  },
  emits: ["update-query", "run-query", "update:query", "focus", "blur"],
  setup(props, { emit }) {
    const store = useStore();
    const editorRef: any = ref();
    let editorView: any = null;

    // Track event listeners
    const clickListener = () => {
      editorView?.requestMeasure();
    };
    const resizeListener = async () => {
      await nextTick();
      editorView?.requestMeasure();
    };

    // VRL language support
    const createVrlLanguage = () => {
      return {
        name: "vrl",
        tokenizer: vrlLanguageDefinition.tokenizer,
        keywords: vrlLanguageDefinition.keywords,
        symbols: vrlLanguageDefinition.symbols,
        escapes: vrlLanguageDefinition.escapes,
        brackets: vrlLanguageDefinition.brackets,
      };
    };

    // Get language support based on props.language
    const getLanguageSupport = () => {
      switch (props.language) {
        case "sql":
          return sql();
        case "vrl":
          return sql();
        case "json":
          return json();
        case "javascript":
          return javascript();
        case "markdown":
          return markdown();
        case "html":
          return html();
        default:
          return sql();
      }
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

    // Create autocompletion function
    const createAutocompletion = () => {
      if (!props.showAutoComplete) return [];

      return autocompletion({
        override: [
          (context: CompletionContext) => {
            const word = context.matchBefore(/\w*/);

            if (!word.text && !props.autoComplete.showEmpty) return null;

            const textUntilPosition = context.state.doc.sliceString(
              0,
              context.pos,
            );
            const arr = textUntilPosition.trim().split(" ");
            const lastElement = arr.pop();

            let completions: Completion[] = [];

            // Add keywords
            keywords.value.forEach((keyword: any) => {
              if (
                keyword.label.toLowerCase().includes(word.text.toLowerCase())
              ) {
                completions.push({
                  label: keyword.label,
                  type: keyword.kind?.toLowerCase() || "keyword",
                  apply: keyword.insertText,
                });
              }
            });
            // Add suggestions
            suggestions.value.forEach((suggestion: any) => {
              completions.push({
                label: suggestion.label(lastElement),
                type: suggestion.kind?.toLowerCase() || "text",
                apply: suggestion.insertText(lastElement),
              });
            });

            return {
              from: word.from,
              options: completions,
              filter: props.autoComplete.filter,
            };
          },
        ],
        filterStrict: props.autoComplete.filterStrict,
        selectOnOpen: props.autoComplete.selectOnOpen,
      });
    };

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

    const customDarkTheme = EditorView.theme(
      {
        ".cm-editor": {
          backgroundColor: "#1e1e1e !important", // Custom dark background
        },
        ".cm-scroller": {
          backgroundColor: "#1e1e1e !important",
          fontFamily: "Menlo, Monaco, 'Courier New', monospace !important",
          fontWeight: "normal !important",
          fontSize: "12px !important",
          fontFeatureSettings: "liga 0, calt 0 !important",
          fontVariationSettings: "normal !important",
          lineHeight: "18px !important",
          letterSpacing: "0px !important",
        },
        ".cm-cursor": {
          borderLeft: "2px solid #d4d4d4 !important", // bright pink for visibility
        },
        ".cm-gutters": {
          backgroundColor: "transparent !important",
          borderRight: "none !important",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "transparent !important",
        },
        ".cm-line": {
          paddingLeft: "0px !important",
        },
      },
      { dark: true },
    );
    const customLightTheme = EditorView.theme({
      ".cm-editor": {
        backgroundColor: "#fafafa !important", // Your light mode background
      },
      ".cm-scroller": {
        backgroundColor: "#fafafa !important",
        fontFamily: "Menlo, Monaco, 'Courier New', monospace !important",
        fontWeight: "normal !important",
        fontSize: "12px !important",
        fontFeatureSettings: "liga 0, calt 0 !important",
        fontVariationSettings: "normal !important",
        lineHeight: "18px !important",
        letterSpacing: "0px !important",
      },
      ".cm-cursor": {
        borderLeft: "2px solid #000000 !important", // bright pink for visibility
      },
      ".cm-gutters": {
        backgroundColor: "transparent !important",
        borderRight: "none !important",
        marginRight: "0px !important",
      },
      ".cm-gutter": {
        marginRight: "0px !important",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent !important",
      },
      ".cm-line": {
        paddingLeft: "0px !important",
      },
    });

    const createTheme = () => {
      return store.state.theme === "dark"
        ? [o2QueryEditorDarkTheme, customDarkTheme]
        : [o2QueryEditorLightTheme, customLightTheme];
    };

    // Create keymap with Ctrl+Enter support
    const createKeymap = () => {
      return keymap.of([
        indentWithTab,
        {
          key: "Ctrl-Enter",
          preventDefault: true,
          stopPropagation: true,
          run: () => {
            setTimeout(() => {
              emit("run-query");
            }, 300);
            return true;
          },
        },
        {
          key: "Cmd-Enter",
          preventDefault: true,
          stopPropagation: true,
          run: () => {
            setTimeout(() => {
              emit("run-query");
            }, 300);
            return true;
          },
        },
        ...closeBracketsKeymap, // Auto close brackets
        ...searchKeymap, // ⌘F / Ctrl+F and other search-related key bindings
      ]);
    };

    const setTooltip = StateEffect.define<Tooltip | null>();

    const tooltipField = StateField.define<Tooltip | null>({
      create: () => null,
      update(value, tr) {
        for (const e of tr.effects) {
          if (e.is(setTooltip)) return e.value;
        }
        return value;
      },
      provide: f => showTooltip.from(f)
    });

    function showTooltipAtCursor(view: EditorView, message: string) {
      const pos = view.state.selection.main.head;

      const tooltip = {
        pos,
        above: true,
        strictSide: true,
        create() {
          const dom = document.createElement("div");
          dom.textContent = message;
          dom.className = "cm-tooltip-readonly";
          return { dom };
        }
      };

      view.dispatch({ effects: setTooltip.of(tooltip) });
    }

    const onFocusExtension = EditorView.domEventHandlers({
      focus(event, view) {
        if (view.state.readOnly) {
          showTooltipAtCursor(view, "Can not edit in read-only mode.");
        }
      }
    })

    // Debounced emit for document changes
    const debouncedEmit = debounce((value: string, update: any) => {
      emit("update-query", update, value);
      emit("update:query", value);
    }, props.debounceTime);

    const setupEditor = async () => {
      // Ensure proper cleanup before setting up new editor
      cleanupEditor();

      let editorElement = document.getElementById(props.editorId);
      let retryCount = 0;
      const maxRetries = 5;

      // Retry mechanism to ensure the editor element is found
      while (!editorElement && retryCount < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        editorElement = document.getElementById(props.editorId);
        retryCount++;
      }

      if (!editorElement) {
        console.error("Query Editor element not found after retries");
        return;
      }

      // Clear any existing child nodes
      if (editorElement && editorElement?.hasChildNodes()) {
        editorElement.innerHTML = "";
      }

      // below line is used to set read only mode
      // readOnlyCompartment.of(EditorState.readOnly.of(true)),
      try {
        const readOnlyCompartment = new Compartment()
        const state = EditorState.create({
          doc: props.query?.trim() || "",
          extensions: [
            readOnlyCompartment.of(EditorState.readOnly.of(props.readOnly)),
            tooltipField,
            onFocusExtension,
            minimalSetup,
            closeBrackets(),
            EditorView.lineWrapping,
            search(),
            highlightSelectionMatches(), // ✨ Highlights all matches
            lineNumbers(),
            getLanguageSupport(),
            props.showAutoComplete ? createAutocompletion() : [],
            ...createTheme(),
            createKeymap(),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                debouncedEmit(update.state.doc.toString(), update);
              }
            }),
            EditorView.focusChangeEffect.of((state, focusing) => {
              if (focusing) {
                emit("focus");
              } else {
                const value = state.doc.toString();
                const trimmedValue = value.trim();
                if (value !== trimmedValue) {
                  const transaction = state.update({
                    changes: {
                      from: 0,
                      to: state.doc.length,
                      insert: trimmedValue,
                    },
                  });
                  editorView?.dispatch(transaction);
                }
                emit("blur");
              }
              return null;
            }),

            EditorView.theme({
              "&": {
                fontSize: "14px",
                height: "100%",
              },
              ".cm-editor": {
                height: "100%",
              },
              ".cm-scroller": {
                fontFamily: "monospace",
              },
              ".cm-line": {
                lineHeight: "17px",
                padding: "0px !important",
              },
              ".cm-foldGutter": {
                display: "none !important",
              },
              ".cm-lineNumbers .cm-gutterElement": {
                padding: "0px 2px !important",
              },
            }),
            basicSetup,
          ],
        });

        editorView = new EditorView({
          state,
          parent: editorElement as HTMLElement,
        });

        editorView.docView["lineWrapping"] = true;

        // Set readonly if needed
        if (props.readOnly) {
          // For now, we'll handle readonly through the UI
          // CodeMirror v6 handles this differently
        }
      } catch (error) {
        console.error("Error creating CodeMirror editor:", error);
        return;
      }

      // Clean up old listeners before adding new ones
      window.removeEventListener("click", clickListener);
      window.removeEventListener("resize", resizeListener);

      // Add listeners
      window.addEventListener("click", clickListener);
      window.addEventListener("resize", resizeListener);
    };

    // Comprehensive cleanup function
    const cleanupEditor = () => {
      // Remove window event listeners
      window.removeEventListener("click", clickListener);
      window.removeEventListener("resize", resizeListener);

      // Dispose editor
      if (editorView) {
        try {
          editorView.destroy();
        } catch (error) {
          console.warn("Error disposing editor:", error);
        }
        editorView = null;
      }
      editorRef.value = null;
    };

    onMounted(async () => {
      setupEditor();
    });

    onActivated(async () => {
      if (!editorView) {
        setupEditor();
        if (editorView) (editorView as any)?.requestMeasure();
      }
    });

    onDeactivated(() => {
      // No specific cleanup needed for CodeMirror on deactivate
    });

    onUnmounted(() => {
      cleanupEditor();
    });

    const enableCodeFolding = computed(() => {
      return ["json", "html", "javascript"].includes(props.language);
    });

    // Watch for prop changes
    watch(
      () => props.readOnly,
      () => {
        // Handle readonly state changes
        if (editorView) {
          // For now, we'll recreate the editor when readonly changes
          setupEditor();
        }
      },
    );

    watch(
      () => store.state.theme,
      () => {
        // Recreate editor with new theme
        setupEditor();
      },
    );

    watch(
      () => props.query,
      (value) => {
        if (editorView && (props.readOnly || !editorView.hasFocus)) {
          const currentValue = editorView.state.doc.toString();
          if (currentValue !== value) {
            editorView.dispatch({
              changes: {
                from: 0,
                to: currentValue.length,
                insert: value,
              },
            });
          }
        }
      },
    );

    const setValue = (value: string) => {
      if (editorView) {
        editorView.dispatch({
          changes: {
            from: 0,
            to: editorView.state.doc.length,
            insert: value,
          },
        });
        editorView.requestMeasure();
      }
    };

    const resetEditorLayout = () => {
      editorView?.requestMeasure();
    };

    const disableSuggestionPopup = () => {
      // CodeMirror handles this automatically
      if (editorView) {
        // Close any open completions by dispatching an empty transaction
        closeCompletion(editorView);
      }
    };

    const triggerAutoComplete = async (value: string) => {
      disableSuggestionPopup();
      await nextTick();
      if (editorView) {
        // Trigger autocompletion by dispatching a transaction
        startCompletion(editorView);
      }
    };

    const formatDocument = async () => {
      // CodeMirror doesn't have built-in formatting, but we can implement basic formatting
      return new Promise((resolve) => {
        if (editorView) {
          // Basic formatting: trim whitespace and ensure proper indentation
          const currentValue = editorView.state.doc.toString();
          const formattedValue = currentValue
            .split("\n")
            .map((line: any) => line.trim())
            .filter((line: any) => line.length > 0)
            .join("\n");

          if (currentValue !== formattedValue) {
            editorView.dispatch({
              changes: {
                from: 0,
                to: currentValue.length,
                insert: formattedValue,
              },
            });
          }
        }
        resolve(true);
      });
    };

    const getCursorIndex = () => {
      if (editorView) {
        return editorView.state.selection.main.head - 1;
      }
      return null;
    };

    const getModel = () => {
      return editorView?.state;
    };

    const getValue = () => {
      return editorView?.state.doc.toString();
    };

    const decorateRanges = (ranges: any[]) => {
      // Basic implementation - highlight lines with CSS classes
      if (!editorView) return;

      // For now, we'll add a simple class to the editor element
      const editorElement = editorView.dom;
      editorElement.classList.add("has-error-highlights");
    };

    const addErrorDiagnostics = (ranges: any[]) => {
      // Basic implementation - add error markers
      if (!editorView) return;

      // For now, we'll add a simple class to the editor element
      const editorElement = editorView.dom;
      editorElement.classList.add("has-error-diagnostics");
    };

    const forceCleanup = () => {
      cleanupEditor();
    };

    return {
      editorRef,
      editorView,
      setValue,
      resetEditorLayout,
      disableSuggestionPopup,
      triggerAutoComplete,
      getCursorIndex,
      formatDocument,
      getModel,
      getValue,
      decorateRanges,
      addErrorDiagnostics,
      cleanupEditor,
      forceCleanup,
      store,
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
</style>

<style lang="scss">
.cm-focused {
  outline: none !important;
}
.cm-lineNumbers .cm-gutterElement {
  min-width: 10px !important;
  padding-right: 5px !important;
  text-align: left;
}
.cm-gutter .cm-foldGutter {
  display: none !important;
}

.cm-activeLine {
  background-color: transparent !important;
}

.cm-tooltip-readonly {
  padding: 4px 8px;
  font-size: 13px;
  border-radius: 4px;
  z-index: 100;
}

.theme-dark .cm-tooltip-readonly {
  background: #444;
  color: white;
}

.theme-light .cm-tooltip-readonly {
  background: #f5f5f5;
  color: #333;
}
</style>
