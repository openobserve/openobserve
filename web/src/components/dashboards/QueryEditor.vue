<!-- Copyright 2022 Zinc Labs Inc. and Contributors

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
  <div ref="editorRef" id="editor"></div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onUpdated, watch } from "vue";
import * as monaco from "monaco-editor";
import { useStore } from "vuex";
import { cloneDeep } from "lodash-es";

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
    functions: {
      type: Array,
      default: [],
    },
    readOnly: {
      type: Boolean,
      default: false,
    },
    keywords: {
      type: Array,
      default: [],
    },
    suggestions: {
      type: Array,
      default: [],
    },
  },
  emits: ["update-query", "run-query", "update:query"],
  setup(props, { emit }) {
    const store = useStore();
    const editorRef: any = ref();
    let editorObj: any = null;

    // create list of CompletionItemKind
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
      console.log("createDependencyProposals", cloneDeep(props.keywords));
      return props.keywords.map((keyword: any) => {
        const itemObj: any = {
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

      monaco.languages.registerCompletionItemProvider("promql", {
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

          console.log("auto complete");
          filteredSuggestions = createDependencyProposals(range);
          filteredSuggestions = filteredSuggestions.filter((item) => {
            return item.label.toLowerCase().includes(word.word.toLowerCase());
          });

          // if (filteredSuggestions.length == 0) {
          const lastElement = arr.pop();

          filteredSuggestions.push({
            label: `match_all('${lastElement}')`,
            kind: monaco.languages.CompletionItemKind.Text,
            insertText: `match_all('${lastElement}')`,
            range: range,
          });
          filteredSuggestions.push({
            label: `match_all_ignore_case('${lastElement}')`,
            kind: monaco.languages.CompletionItemKind.Text,
            insertText: `match_all_ignore_case('${lastElement}')`,
            range: range,
          });

          return {
            suggestions: filteredSuggestions,
          };
        },
      });

      editorObj = monaco.editor.create(editorRef.value, {
        value: props.query,
        language: "sql",
        theme: "myCustomTheme",
        showFoldingControls: "never",
        wordWrap: "on",
        lineNumbers: "on",
        lineNumbersMinChars: 0,
        overviewRulerLanes: 0,
        fixedOverflowWidgets: false,
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
        emit("update:query", e, editorObj.getValue());
      });

      editorObj.createContextKey("ctrlenter", true);
      editorObj.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        function () {
          emit("run-query");
        },
        "ctrlenter"
      );
    });

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

    return {
      editorRef,
      editorObj,
      setValue,
    };
  },
});
</script>

<style>
#editor {
  min-height: 4rem;
  border-radius: 5px;
  border: 0px solid #dbdbdb;
}

.monaco-editor,
.monaco-editor .monaco-editor {
  padding: 0px 0px 0px 0px !important;
}
</style>
