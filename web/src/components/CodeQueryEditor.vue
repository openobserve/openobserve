<template>
  <div
    data-test="query-editor"
    class="logs-query-editor"
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
  onBeforeUnmount,
} from "vue";

import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import {
  autocompletion,
  CompletionContext,
  Completion,
} from "@codemirror/autocomplete";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";
import { vrlLanguageDefinition } from "@/utils/query/vrlLanguageDefinition";

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
  },
  emits: ["update-query", "run-query", "update:query", "focus", "blur"],
  setup(props, { emit }) {
    const store = useStore();
    const editorRef: any = ref();
    let editorView: EditorView | null = null;

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
          return createVrlLanguage();
        default:
          return sql();
      }
    };

    // Create autocompletion function
    const createAutocompletion = () => {
      if (!props.showAutoComplete) return [];

      return autocompletion({
        override: [
          (context: CompletionContext) => {
            const word = context.matchBefore(/\w*/);
            if (!word) return null;

            const textUntilPosition = context.state.doc.sliceString(
              0,
              context.pos,
            );
            const arr = textUntilPosition.trim().split(" ");
            const lastElement = arr.pop();

            let completions: Completion[] = [];

            // Add keywords
            props.keywords.forEach((keyword: any) => {
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
            props.suggestions.forEach((suggestion: any) => {
              completions.push({
                label: suggestion.label(lastElement),
                type: suggestion.kind?.toLowerCase() || "text",
                apply: suggestion.insertText(lastElement),
              });
            });

            return {
              from: word.from,
              options: completions,
            };
          },
        ],
      });
    };

    // Create theme based on store state
    const createTheme = () => {
      return store.state.theme === "dark" ? oneDark : [];
    };

    // Create keymap with Ctrl+Enter support
    const createKeymap = () => {
      return keymap.of([
        indentWithTab,
        {
          key: "Ctrl-Enter",
          run: () => {
            setTimeout(() => {
              emit("run-query");
            }, 300);
            return true;
          },
        },
        {
          key: "Cmd-Enter",
          run: () => {
            setTimeout(() => {
              emit("run-query");
            }, 300);
            return true;
          },
        },
      ]);
    };

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

      try {
        const state = EditorState.create({
          doc: props.query?.trim() || "",
          extensions: [
            basicSetup,
            createAutocompletion(),
            createTheme(),
            createKeymap(),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                const debouncedEmit = debounce((value: string) => {
                  emit("update-query", update, value);
                  emit("update:query", value);
                }, props.debounceTime);
                debouncedEmit(update.state.doc.toString());
              }
            }),
            EditorView.focusChangeEffect.of((state, focusing) => {
              if (focusing) {
                emit("focus");
              } else {
                // Handle blur with trimming
                const value = state.doc.toString();
                const trimmedValue = value.trim();

                if (value !== trimmedValue) {
                  // Apply trim by replacing content
                  const transaction = state.state.update({
                    changes: {
                      from: 0,
                      to: state.state.doc.length,
                      insert: trimmedValue,
                    },
                  });
                  state.dispatch(transaction);
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
            }),
          ],
        });

        editorView = new EditorView({
          state,
          parent: editorElement as HTMLElement,
        });

        // Set readonly if needed
        if (props.readOnly) {
          editorView.dispatch({
            effects: EditorView.editable.of(false),
          });
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
    };

    onMounted(async () => {
      setupEditor();
    });

    onActivated(async () => {
      if (!editorView) {
        setupEditor();
        editorView?.requestMeasure();
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
        if (editorView) {
          editorView.dispatch({
            effects: EditorView.editable.of(!props.readOnly),
          });
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
      () => {
        if (editorView && (props.readOnly || !editorView.hasFocus)) {
          const currentValue = editorView.state.doc.toString();
          if (currentValue !== props.query) {
            editorView.dispatch({
              changes: {
                from: 0,
                to: currentValue.length,
                insert: props.query,
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
      // CodeMirror handles this automatically, but we can close any open completions
      if (editorView) {
        editorView.dispatch({
          effects: autocompletion.closeEffect.of(null),
        });
      }
    };

    const triggerAutoComplete = async (value: string) => {
      disableSuggestionPopup();
      await nextTick();
      if (editorView) {
        editorView.dispatch({
          effects: autocompletion.startCompletion.of(true),
        });
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
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
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
        return editorView.state.selection.main.head;
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
      if (!editorView) return;

      // Create decorations for error highlighting
      const decorations = ranges.map((range) => {
        return EditorView.Decoration.line({
          class: "highlight-error",
        }).range(editorView!.state.doc.line(range.startLine).from);
      });

      // Apply decorations
      editorView.dispatch({
        effects: EditorView.decorations.of(
          EditorView.Decoration.set(decorations),
        ),
      });
    };

    const addErrorDiagnostics = (ranges: any) => {
      if (!editorView) return;

      // Create diagnostics for error reporting
      const diagnostics = ranges.map((range) => ({
        from: editorView!.state.doc.line(range.startLine).from,
        to: editorView!.state.doc.line(range.endLine).to,
        severity: "error" as const,
        message: range.error,
      }));

      // Apply diagnostics
      editorView.dispatch({
        effects: EditorView.diagnostics.of(diagnostics),
      });
    };

    const forceCleanup = () => {
      console.log("Force cleaning up CodeQueryEditor resources...");
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
// .logs-query-editor {
//   .cm-editor {
//     height: 100%;
//     border-radius: 5px;

//     .cm-scroller {
//       font-family: monospace;
//     }

//     .cm-content {
//       padding: 8px;
//     }

//     .cm-line {
//       padding: 0;
//     }
//   }

//   // Ensure CodeMirror editor elements are properly contained
//   .cm-editor .cm-scroller {
//     position: relative !important;
//   }

//   // Clean up any detached CodeMirror elements
//   .cm-editor .cm-gutters,
//   .cm-editor .cm-content {
//     position: absolute !important;
//   }
// }

// .highlight-error {
//   background-color: rgba(255, 0, 0, 0.1);
//   text-decoration: underline;
//   text-decoration-color: red;
// }

// // Ensure CodeMirror editor is properly disposed
// .logs-query-editor:empty {
//   display: none;
// }

// // CodeMirror specific styles
// .cm-tooltip {
//   z-index: 9999;
// }

// .cm-tooltip.cm-completionInfo {
//   z-index: 10000;
// }

// .cm-tooltip.cm-completionInfo .cm-completionInfoLeft {
//   font-weight: bold;
// }

// .cm-tooltip.cm-completionInfo .cm-completionInfoRight {
//   float: right;
//   color: #999;
// }

// .cm-completionMatchedText {
//   text-decoration: underline;
// }

// .cm-completionDetail {
//   margin-left: 1.5em;
//   color: #999;
// }

// .cm-completionIcon {
//   font-size: 90%;
//   width: 1.2em;
//   display: inline-block;
//   text-align: center;
//   padding-right: 0.6em;
//   opacity: 0.6;
// }

// .cm-completionIcon-function,
// .cm-completionIcon-method {
//   color: #7c3aed;
// }

// .cm-completionIcon-class {
//   color: #059669;
// }

// .cm-completionIcon-interface,
// .cm-completionIcon-type {
//   color: #7c3aed;
// }

// .cm-completionIcon-variable,
// .cm-completionIcon-constant {
//   color: #dc2626;
// }

// .cm-completionIcon-keyword {
//   color: #059669;
// }

// .cm-completionIcon-string {
//   color: #dc2626;
// }

// .cm-completionIcon-number {
//   color: #059669;
// }

// .cm-completionIcon-boolean {
//   color: #7c3aed;
// }

// .cm-completionIcon-array {
//   color: #dc2626;
// }

// .cm-completionIcon-object {
//   color: #059669;
// }

// .cm-completionIcon-namespace {
//   color: #7c3aed;
// }

// .cm-completionIcon-enum {
//   color: #dc2626;
// }

// .cm-completionIcon-enumMember {
//   color: #059669;
// }

// .cm-completionIcon-struct {
//   color: #7c3aed;
// }

// .cm-completionIcon-event {
//   color: #dc2626;
// }

// .cm-completionIcon-operator {
//   color: #059669;
// }

// .cm-completionIcon-typeParameter {
//   color: #7c3aed;
// }
</style>
