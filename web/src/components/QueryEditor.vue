<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div
    data-test="query-editor"
    class="logs-query-editor"
    ref="editorRef"
    :id="editorId"
  ></div>
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
} from "vue";

import "monaco-editor/esm/vs/editor/editor.all.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";

import { useStore } from "vuex";
import { debounce } from "quasar";
import useLogs from "@/composables/useLogs";

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
  },
  emits: ["update-query", "run-query", "update:query"],
  setup(props, { emit }) {
    const store = useStore();
    const editorRef: any = ref();
    let editorObj: any = null;
    const { searchObj } = useLogs();

    let provider: Ref<monaco.IDisposable | null> = ref(null);

    const CompletionKind: any = {
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
    const insertTextRules: any = {
      InsertAsSnippet:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      KeepWhitespace:
        monaco.languages.CompletionItemInsertTextRule.KeepWhitespace,
      None: monaco.languages.CompletionItemInsertTextRule.None,
    };

    const createDependencyProposals = (range: any) => {
      return props.keywords.map((keyword: any) => {
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

    onMounted(async () => {
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

      registerAutoCompleteProvider();

      const editorElement = document.getElementById(props.editorId);

      if (!editorElement) console.error("Query Editor element not found");
      if (editorElement && editorElement?.hasChildNodes()) return;

      editorObj = monaco.editor.create(editorElement as HTMLElement, {
        value: props.query,
        language: "sql",
        theme: store.state.theme == "dark" ? "vs-dark" : "myCustomTheme",
        showFoldingControls: "never",
        wordWrap: "on",
        lineNumbers: "on",
        lineNumbersMinChars: 0,
        overviewRulerLanes: 0,
        fixedOverflowWidgets: false,
        overviewRulerBorder: false,
        lineDecorationsWidth: 3,
        hideCursorInOverviewRuler: true,
        renderLineHighlight: "none",
        glyphMargin: false,
        folding: false,
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
      });

      editorObj.onDidChangeModelContent(
        debounce((e: any) => {
          emit("update-query", e, editorObj.getValue());
          emit("update:query", editorObj.getValue());
        }, props.debounceTime)
      );

      editorObj.createContextKey("ctrlenter", true);
      editorObj.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        function () {
          setTimeout(() => {
            emit("run-query");
          }, 300);
        },
        "ctrlenter"
      );

      editorObj.onDidFocusEditorWidget(() => {
        searchObj.meta.queryEditorPlaceholderFlag = false;
      });

      editorObj.onDidBlurEditorWidget(() => {
        searchObj.meta.queryEditorPlaceholderFlag = true;
      });

      window.addEventListener("click", () => {
        editorObj.layout();
      });
    });

    onActivated(async () => {
      provider.value?.dispose();
      registerAutoCompleteProvider();
    });

    onDeactivated(() => {
      provider.value?.dispose();
    });

    onUnmounted(() => {
      provider.value?.dispose();
    });

    // update readonly when prop value changes
    watch(
      () => props.readOnly,
      () => {
        editorObj.updateOptions({ readOnly: props.readOnly });
      }
    );

    // update readonly when prop value changes
    watch(
      () => props.query,
      () => {
        if (props.readOnly || !editorObj.hasWidgetFocus()) {
          editorObj.getModel().setValue(props.query);
        }
      }
    );

    const setValue = (value: string) => {
      if (editorObj?.setValue) editorObj.setValue(value);
    };

    const registerAutoCompleteProvider = () => {
      if (!props.showAutoComplete) return;
      provider.value = monaco.languages.registerCompletionItemProvider("sql", {
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

          // if (filteredSuggestions.length == 0) {
          const lastElement = arr.pop();
          props.suggestions.forEach((suggestion: any) => {
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
      });
    };

    const resetEditorLayout = () => {
      editorObj.layout();
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

    const getCursorIndex = () => {
      const currentPosition = editorObj.getPosition();
      const cursorIndex = editorObj.getModel().getOffsetAt(currentPosition) - 1;
      return cursorIndex || null;
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
    };
  },
  computed: {
    editorFocus() {
      return this.editorRef;
    },
  },
  watch: {
    editorFocus: {
      handler: function (newVal, oldVal) {
        console.log(newVal, oldVal);
      },
      immediate: true,
    },
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
}
</style>
