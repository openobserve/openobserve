import { ref, nextTick } from "vue";
import { useStore } from "vuex";

const useSqlSuggestions = () => {
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
    {
      label: (_keyword: string) => `arr_descending('${_keyword}')`,
      kind: "Text",
      insertText: (_keyword: string) => `arr_descending('${_keyword}')`,
    },
    {
      label: (_keyword: string) => `arrcount('${_keyword}')`,
      kind: "Text",
      insertText: (_keyword: string) => `arrcount('${_keyword}')`,
    },
    {
      label: (_keyword: string) => `arrsort('${_keyword}')`,
      kind: "Text",
      insertText: (_keyword: string) => `arrsort('${_keyword}')`,
    },
    {
      label: (_keyword: string) => `cast_to_arr('${_keyword}')`,
      kind: "Text",
      insertText: (_keyword: string) => `cast_to_arr('${_keyword}')`,
    },
    {
      label: (_keyword: string, start: number = 1, end: number = 10) =>
        `arrindex('${_keyword}', ${start}, ${end})`,
      kind: "Text",
      insertText: (_keyword: string, start: number = 1, end: number = 10) =>
        `arrindex('${_keyword}', ${start}, ${end})`,
    },
    {
      label: (_keyword: string, delimiter: string = "delimiter") =>
        `arrjoin('${_keyword}', '${delimiter}')`,
      kind: "Text",
      insertText: (_keyword: string, delimiter: string = "delimiter") =>
        `arrjoin('${_keyword}', '${delimiter}')`,
    },

    {
      label: (
        _keyword: string,
        _keyword2: string,
        delimiter: string = "delimiter",
      ) => `arrzip('${_keyword}', '${_keyword2}', '${delimiter}')`,
      kind: "Text",
      insertText: (
        _keyword: string,
        _keyword2: string,
        delimiter: string = "delimiter",
      ) => `arrzip('${_keyword}', '${_keyword2}', '${delimiter}')`,
    },
    {
      label: (_keyword: string, path: string = "path") =>
        `spath('${_keyword}', '${path}')`,
      kind: "Text",
      insertText: (_keyword: string, path: string = "path") =>
        `spath('${_keyword}', '${path}')`,
    },
    {
      label: (array: string = "array") => `to_array_string('${array}')`,
      kind: "Text",
      insertText: (array: string = "array") => `to_array_string('${array}')`,
    },
    {
      label: () => `unnest`,
      kind: "Text",
      insertText: () => `unnest`,
    },
    {
      label: () => `array_extract`,
      kind: "Text",
      insertText: () => `array_extract`,
    },

    //from here aggregation functions are added
    {
      label: (_keyword: string) => `sum('${_keyword}')`,
      kind: "Text",
      insertText: (_keyword: string) => `sum('${_keyword}')`,
    },
    {
      label: (_keyword: string) => `avg('${_keyword}')`,
      kind: "Text",
      insertText: (_keyword: string) => `avg('${_keyword}')`,
    },
    {
      label: (_keyword: string) => `count('${_keyword}')`,
      kind: "Text",
      insertText: (_keyword: string) => `count('${_keyword}')`,
    },
    {
      label: (_keyword: string) => `max('${_keyword}')`,
      kind: "Text",
      insertText: (_keyword: string) => `max('${_keyword}')`,
    },
    {
      label: (_keyword: string) => `min('${_keyword}')`,
      kind: "Text",
      insertText: (_keyword: string) => `min('${_keyword}')`,
    },
    //histogram function
    {
      label: (_keyword: string, duration: string = "duration") =>
        `histogram('${_keyword}', '${duration}')`,
      kind: "Text",
      insertText: (_keyword: string, duration: string = "duration") =>
        `histogram('${_keyword}', '${duration}')`,
    },
    {
      label: (_keyword: string, number_of_frequent_values: number = 10) =>
        `approx_topk('${_keyword}', ${number_of_frequent_values})`,
      kind: "Text",
      insertText: (_keyword: string, number_of_frequent_values: number = 10) =>
        `approx_topk('${_keyword}', ${number_of_frequent_values})`,
    },
    {
      label: (
        _keyword: string,
        _keyword2: string,
        number_of_frequent_values: number = 10,
      ) =>
        `approx_topk_distinct('${_keyword}', '${_keyword2}', ${number_of_frequent_values})`,
      kind: "Text",
      insertText: (
        _keyword: string,
        _keyword2: string,
        number_of_frequent_values: number = 10,
      ) =>
        `approx_topk_distinct('${_keyword}', '${_keyword2}', ${number_of_frequent_values})`,
    },
  ];
  const autoCompleteData = ref({
    fieldValues: {} as any, // { kubernetes_host: new Set([value1, value2]) }
    query: "",
    position: {
      cursorIndex: 0,
    },
    popup: {
      open: (val: string) => {},
      close: (val: string) => {},
    },
  });
  const autoCompleteSuggestions: any = ref([]);
  const loading = ref(false);
  const autoCompleteKeywords: any = ref([]);
  const store = useStore();
  const functionKeywords: any = ref([]);
  let fieldKeywords: any = [];

  function analyzeSqlWhereClause(whereClause: string, cursorIndex: number) {
    const labelMeta = {
      hasLabels: false,
      isFocused: false,
      isEmpty: true,
      focusOn: "", // label or value
      meta: {
        label: "",
        value: "",
      },
    };

    const columnValueRegex = /(\w+)\s*=\s*$|\w+\s+IN\s+\($/i;

    let match;
    while ((match = columnValueRegex.exec(whereClause)) !== null) {
      const column = match[1];

      if (cursorIndex <= match.index + match[0].length - 1) {
        labelMeta.focusOn = "value";
        labelMeta.isFocused = true;
        labelMeta.meta.label = column;

        break; // Exit the loop after processing the match
      }
    }
    return labelMeta;
  }

  const getSuggestions = async () => {
    autoCompleteKeywords.value = [];
    const cursorIndex = autoCompleteData.value.position.cursorIndex;
    const sqlWhereClause = analyzeSqlWhereClause(
      autoCompleteData.value.query,
      cursorIndex,
    );
    if (
      sqlWhereClause.meta.label &&
      autoCompleteData.value.fieldValues[sqlWhereClause.meta.label]
    ) {
      const values = Array.from(
        autoCompleteData.value.fieldValues[sqlWhereClause.meta.label] ||
          new Set(),
      ).map((item) => {
        return {
          label: item,
          insertText: `'${item}'`,
          kind: "Keyword",
        };
      });

      autoCompleteKeywords.value = [...values];
      autoCompleteSuggestions.value = [];
      autoCompleteData.value.popup.open(autoCompleteData.value.query);
    } else {
      updateAutoComplete();
    }
  };

  const updateAutoComplete = () => {
    autoCompleteKeywords.value = [];
    autoCompleteKeywords.value.push(...functionKeywords.value);
    for (const item of fieldKeywords) {
      autoCompleteKeywords.value.push(item);
    }
    autoCompleteKeywords.value.push(...defaultKeywords);
    autoCompleteSuggestions.value = [...defaultSuggestions];
  };

  const updateFieldKeywords = (fields: any[]) => {
    autoCompleteKeywords.value = [];
    fieldKeywords = [];
    let itemObj: any = {};
    fields.forEach((field: any) => {
      if (field.name == store.state.zoConfig.timestamp_column) {
        return;
      }
      itemObj = {
        label: field.name,
        kind: "Field",
        insertText: field.name,
        insertTextRules: "InsertAsSnippet",
      };
      fieldKeywords.push(itemObj);
    });
    updateAutoComplete();
  };

  const updateFunctionKeywords = (functions: any[]) => {
    functionKeywords.value = [];
    functions.forEach((field: any) => {
      const itemObj = {
        label: field.name,
        kind: "Function",
        insertText: field.name + field.args,
        insertTextRules: "InsertAsSnippet",
      };
      functionKeywords.value.push(itemObj);
    });
    updateAutoComplete();
  };

  return {
    autoCompleteData,
    autoCompleteKeywords,
    autoCompleteSuggestions,
    loading,
    getSuggestions,
    updateFieldKeywords,
    updateFunctionKeywords,
  };
};

export default useSqlSuggestions;
