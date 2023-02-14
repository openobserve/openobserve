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
import { defineComponent, ref, onMounted, onUpdated } from "vue";
import * as monaco from "monaco-editor";

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
  },
  emits: ["update-query", "run-query"],
  setup(props, { emit }) {
    const editorRef: any = ref();
    let editorObj: any = null;

    const createDependencyProposals = (range: any) => {
      const keywords = [
        {
          label: "and",
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: "and ",
          range: range,
        },
        {
          label: "or",
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: "or ",
          range: range,
        },
        {
          label: "like",
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: "like '%${1:params}%' ",
          range: range,
        },
        {
          label: "in",
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: "in ('${1:params}') ",
          range: range,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        },
        {
          label: "not in",
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: "not in ('${1:params}') ",
          range: range,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        },
        {
          label: "between",
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: "between('${1:params}','${1:params}') ",
          range: range,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        },
        {
          label: "not between",
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: "not between('${1:params}','${1:params}') ",
          range: range,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        },
        {
          label: "is null",
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: "is null ",
          range: range,
        },
        {
          label: "is not null",
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: "is not null ",
          range: range,
        },
        {
          label: ">",
          kind: monaco.languages.CompletionItemKind.Operator,
          insertText: "> ",
          range: range,
        },
        {
          label: "<",
          kind: monaco.languages.CompletionItemKind.Operator,
          insertText: "< ",
          range: range,
        },
        {
          label: ">=",
          kind: monaco.languages.CompletionItemKind.Operator,
          insertText: ">= ",
          range: range,
        },
        {
          label: "<=",
          kind: monaco.languages.CompletionItemKind.Operator,
          insertText: "<= ",
          range: range,
        },
        {
          label: "<>",
          kind: monaco.languages.CompletionItemKind.Operator,
          insertText: "<> ",
          range: range,
        },
        {
          label: "=",
          kind: monaco.languages.CompletionItemKind.Operator,
          insertText: "= ",
          range: range,
        },
        {
          label: "!=",
          kind: monaco.languages.CompletionItemKind.Operator,
          insertText: "!= ",
          range: range,
        },
        {
          label: "()",
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: "(${1:condition}) ",
          range: range,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        },
      ];

      props.fields.forEach((field: any) => {
        if (field.name == "_timestamp") {
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

      return keywords;
    };

    onMounted(async () => {
      //   editorRef.value.addEventListener("keyup", onKeyUp);

      monaco.editor.defineTheme("myCustomTheme", {
        base: "vs", // can also be vs-dark or hc-black
        inherit: true, // can also be false to completely replace the builtin rules
        rules: [{ token: "comment", background: "FF0000" }],
        colors: {
          "editor.foreground": "#000000",
          "editor.background": "#F7F7F7",
          "editorCursor.foreground": "#000000",
          "editor.lineHighlightBackground": "#000000",
          "editorLineNumber.foreground": "#000000",
          "editor.border": "#000000",
        },
      });

      monaco.languages.registerCompletionItemProvider("sql", {
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

          filteredSuggestions.push({
            label: `match_all('${lastElement}')`,
            kind: monaco.languages.CompletionItemKind.Text,
            insertText: `match_all('${lastElement}')`,
            range: range,
          });
          filteredSuggestions.push({
            label: `match_all_no_case('${lastElement}')`,
            kind: monaco.languages.CompletionItemKind.Text,
            insertText: `match_all_no_case('${lastElement}')`,
            range: range,
          });

          return {
            suggestions: filteredSuggestions,
          };
          // } else {
          //   return {
          //     suggestions: filteredSuggestions,
          //   };
          // }
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
      });

      editorObj.onDidChangeModelContent((e: any) => {
        emit("update-query", editorObj.getValue());
      });

      editorObj.createContextKey("ctrlenter", true);
      editorObj.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        function () {
          emit("run-query");
        },
        "ctrlenter"
      );

      // editorObj.onDidBlurEditorWidget(() => {
      //   // onBlur();
      // });

      //   //   editorObj.dispose();
    });

    const setValue = (value: string) => {
      editorObj.setValue(value);
    };

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
