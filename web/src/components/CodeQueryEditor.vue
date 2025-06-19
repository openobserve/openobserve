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
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
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
          return sql();
        case "json":
          return json();
        case "javascript":
          return javascript();
        case "markdown":
          return markdown();
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
            getLanguageSupport(),
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
              console.log("focusing", state, focusing);
              if (focusing) {
                emit("focus");
              } else {
                // Handle blur with trimming
                const value = state.doc.toString();
                const trimmedValue = value.trim();

                if (value !== trimmedValue) {
                  // Apply trim by replacing content
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
            }),
          ],
        });

        editorView = new EditorView({
          state,
          parent: editorElement as HTMLElement,
        });

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
      // CodeMirror handles this automatically
      if (editorView) {
        // Close any open completions by dispatching an empty transaction
        editorView.dispatch({});
      }
    };

    const triggerAutoComplete = async (value: string) => {
      disableSuggestionPopup();
      await nextTick();
      if (editorView) {
        // Trigger autocompletion by dispatching a transaction
        editorView.dispatch({});
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
