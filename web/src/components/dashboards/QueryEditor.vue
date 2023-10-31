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
    data-test="dashboard-panel-query-editor-div" 
    class="dashboard-query-editor"
    ref="editorRef" 
    id="editor">
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  onUpdated,
  watch,
  onActivated,
  onUnmounted,
  onDeactivated,
  type Ref,
  nextTick,
} from "vue";

import "monaco-editor/esm/vs/editor/editor.all.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";

import { useStore } from "vuex";

export default defineComponent({
  props: {
    query: {
      type: String,
      default: "",
    },
    fields: {
      type: Array,
      default: [],
    },
    keywords: {
      type: Array,
      default: () => [],
    },
    suggestions: {
      type: Array,
      default: () => [],
    },
    functions: {
      type: Array,
      default: [],
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
    console.log("props.functions", props.functions);

    const createDependencyProposals = (range: any) => {
      let keywords = [
        // {
        //   label: "and",
        //   kind: monaco.languages.CompletionItemKind.Keyword,
        //   insertText: "and ",
        //   range: range,
        // },
        // {
        //   label: "or",
        //   kind: monaco.languages.CompletionItemKind.Keyword,
        //   insertText: "or ",
        //   range: range,
        // },
        // {
        //   label: "like",
        //   kind: monaco.languages.CompletionItemKind.Keyword,
        //   insertText: "like '%${1:params}%' ",
        //   range: range,
        // },
        // {
        //   label: "in",
        //   kind: monaco.languages.CompletionItemKind.Keyword,
        //   insertText: "in ('${1:params}') ",
        //   range: range,
        //   insertTextRules:
        //     monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        // },
        // {
        //   label: "not in",
        //   kind: monaco.languages.CompletionItemKind.Keyword,
        //   insertText: "not in ('${1:params}') ",
        //   range: range,
        //   insertTextRules:
        //     monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        // },
        // {
        //   label: "between",
        //   kind: monaco.languages.CompletionItemKind.Keyword,
        //   insertText: "between('${1:params}','${1:params}') ",
        //   range: range,
        //   insertTextRules:
        //     monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        // },
        // {
        //   label: "not between",
        //   kind: monaco.languages.CompletionItemKind.Keyword,
        //   insertText: "not between('${1:params}','${1:params}') ",
        //   range: range,
        //   insertTextRules:
        //     monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        // },
        // {
        //   label: "is null",
        //   kind: monaco.languages.CompletionItemKind.Keyword,
        //   insertText: "is null ",
        //   range: range,
        // },
        // {
        //   label: "is not null",
        //   kind: monaco.languages.CompletionItemKind.Keyword,
        //   insertText: "is not null ",
        //   range: range,
        // },
        // {
        //   label: ">",
        //   kind: monaco.languages.CompletionItemKind.Operator,
        //   insertText: "> ",
        //   range: range,
        // },
        // {
        //   label: "<",
        //   kind: monaco.languages.CompletionItemKind.Operator,
        //   insertText: "< ",
        //   range: range,
        // },
        // {
        //   label: ">=",
        //   kind: monaco.languages.CompletionItemKind.Operator,
        //   insertText: ">= ",
        //   range: range,
        // },
        // {
        //   label: "<=",
        //   kind: monaco.languages.CompletionItemKind.Operator,
        //   insertText: "<= ",
        //   range: range,
        // },
        // {
        //   label: "<>",
        //   kind: monaco.languages.CompletionItemKind.Operator,
        //   insertText: "<> ",
        //   range: range,
        // },
        // {
        //   label: "=",
        //   kind: monaco.languages.CompletionItemKind.Operator,
        //   insertText: "= ",
        //   range: range,
        // },
        // {
        //   label: "!=",
        //   kind: monaco.languages.CompletionItemKind.Operator,
        //   insertText: "!= ",
        //   range: range,
        // },
        // {
        //   label: "()",
        //   kind: monaco.languages.CompletionItemKind.Keyword,
        //   insertText: "(${1:condition}) ",
        //   range: range,
        //   insertTextRules:
        //     monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        // },
      ];

      props.keywords.forEach((keyword: any) => {
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
        keywords.push(itemObj);
      });

      props.fields.forEach((field: any) => {
        if (field.name == store.state.zoConfig.timestamp_column) {
          return;
        }
        let itemObj = {
          label: field.name,
          kind: monaco.languages.CompletionItemKind.Text,
          insertText: field.name,
          range: range,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        };
        keywords.push(itemObj);
      });

      props.functions.forEach((field: any) => {
        let itemObj = {
          label: field.name,
          kind: monaco.languages.CompletionItemKind.Text,
          insertText: field.name + field.args,
          range: range,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        };
        keywords.push(itemObj);
      });
      console.log("keywords", keywords);
      return keywords;
    };

    onMounted(async () => {
      console.log("onMounted");
      //   editorRef.value.addEventListener("keyup", onKeyUp);

      monaco.editor.defineTheme("myCustomTheme", {
        base: "vs", // can also be vs-dark or hc-black
        inherit: true, // can also be false to completely replace the builtin rules
        rules: [{ token: "comment", background: "FF0000" }],
        colors: {
          "editor.foreground": "#000000",
          "editor.background": "#fafafa",
          "editorCursor.foreground": "#000000",
          "editor.lineHighlightBackground": "#FFFFFF",
          "editorLineNumber.foreground": "#ececec",
          "editor.border": "#ececec",
        },
      });

      registerAutoCompleteProvider();

      editorObj = monaco.editor.create(editorRef.value, {
        value: props.query,
        language: "sql",
        theme: store.state.theme == "dark" ? "vs-dark" : "myCustomTheme",
        showFoldingControls: "never",
        wordWrap: "on",
        lineNumbers: "on",
        lineNumbersMinChars: 0,
        overviewRulerLanes: 0,
        fixedOverflowWidgets: true,
        overviewRulerBorder: false,
        lineDecorationsWidth: 15,
        hideCursorInOverviewRuler: true,
        renderLineHighlight: "none",
        glyphMargin: false,
        folding: false,
        scrollBeyondLastColumn: 0,
        scrollBeyondLastLine: true,
        scrollbar: { horizontal: "auto", vertical: "visible" },
        find: {
          addExtraSpaceOnTop: false,
          autoFindInSelection: "never",
          seedSearchStringFromSelection: "never",
        },
        minimap: { enabled: false },
        readOnly: props.readOnly,
      });

      editorObj.onDidChangeModelContent((e: any) => {
        emit("update-query", e, editorObj.getValue());
        emit("update:query", editorObj.getValue());
      });

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
    });

    onMounted(async () => {
      provider.value?.dispose();
      registerAutoCompleteProvider();
      window.addEventListener("click", () => {
        editorObj.layout();
        // queryEditorRef.value.resetEditorLayout();
      });
    });

    onActivated(async () => {
      provider.value?.dispose();
      registerAutoCompleteProvider();
    });

    onUnmounted(() => {
      provider.value?.dispose();
    });

    onDeactivated(() => {
      provider.value?.dispose();
    });

    const registerAutoCompleteProvider = () => {
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
console.log("props.suggestions", props.suggestions);
          props.suggestions.forEach((suggestion: any) => {
            console.log("lastElement", suggestion);

            filteredSuggestions.push({
              label: suggestion.label(lastElement),
              kind: monaco.languages.CompletionItemKind[
                suggestion.kind || "Text"
              ],
              insertText: suggestion.insertText(lastElement),
              range: range,
            });

          });
          console.log("filteredSuggestions", filteredSuggestions);
          
          return {
            suggestions: filteredSuggestions,
          };
        },
      });
    };

    const setValue = (value: string) => {
      editorObj.setValue(value);
    };

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

    const resetEditorLayout = () => {
      editorObj.layout();
    };

     const triggerAutoComplete = async (value: string) => {
      console.log('trigger auto complete started');
      
      disableSuggestionPopup();
      await nextTick();
      console.log('trigger suggest');
      editorObj.trigger(value, "editor.action.triggerSuggest", {});
    };

    const disableSuggestionPopup = () => {
      console.log('disable suggestion popup');
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
    };
  },
});
</script>

<style>
#editor {
  min-height: 100%;
  width: 100%;;
  /* min-height: 4rem; */
  border-radius: 5px;
  border: 0px solid #dbdbdb;
}

.monaco-editor,
.monaco-editor .monaco-editor {
  padding: 0px 0px 0px 0px !important;
}
</style>

<style lang="scss">
.dashboard-query-editor {
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