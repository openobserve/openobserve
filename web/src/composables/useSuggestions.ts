import { ref, nextTick } from "vue";
import { useStore } from "vuex";
import { getFieldValuesForSuggestion } from "@/composables/useFieldValueStore";

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
    // [NEW] Stream context — set by SearchBar.vue when a stream is selected.
    // Required to build the composite IDB key: "org|streamType|streamName|fieldName".
    // Without these three, getFieldValuesForSuggestion cannot look up stored values.
    org: "",
    streamType: "",
    streamName: "",
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
        hasOpenQuote: false,
      },
    };

    // Detects whether the cursor is positioned after an operator that expects
    // a value, and extracts the field name to the left of that operator.
    //
    // 4 alternatives — each captures the field name in a different group:
    //   match[1]: symbolic operators  =  !=  <>  >=  <=  >  <
    //             e.g. "status = ", "code >= ", "env != 'pro"
    //   match[2]: IN / NOT IN (
    //             e.g. "status IN (", "env NOT IN ('pro"
    //   match[3]: LIKE / NOT LIKE
    //             e.g. "msg LIKE '", "path NOT LIKE '%api"
    //   match[4]: str_match / fuzzy_match function second argument
    //             e.g. "str_match(field, ", "fuzzy_match(field, 'par"
    //
    // Why >=/<= appear before >/<:
    //   Regex alternation is left-to-right. If > appeared first, ">=" would
    //   match on ">" and stop, leaving "=" unmatched. Longer tokens must come first.
    //
    // Why (?:'[^']*)?$ at the end of each alternative:
    //   Allows the regex to match even after the user has typed an opening quote
    //   and a partial value. Without it, "status = 'pro" would not match — we
    //   would stop showing value suggestions the moment the user starts typing.
    const columnValueRegex =
      /(\w+)\s*(?:!=|<>|>=|<=|=|>|<)\s*(?:'[^']*)?$|(\w+)\s+(?:NOT\s+)?IN\s+\(\s*(?:'[^']*)?$|(\w+)\s+(?:NOT\s+)?LIKE\s*(?:'[^']*)?$|(?:str_match|fuzzy_match)\s*\(\s*(\w+)\s*,\s*(?:'[^']*)?$/i;

    // Slice the query at the cursor position before matching, so that the $
    // anchor lands at the cursor — not at the end of the full query string.
    //
    // Why this matters — auto-closing brackets example:
    //   User types "status IN (" → editor auto-inserts ")" → full string is "status IN ()"
    //   Without slicing: $ anchors after ")" → regex does NOT match
    //   After slicing at cursor (between "(" and ")"): text is "status IN (" → matches
    //
    // cursorIndex = 0 means uninitialized (position.cursorIndex default).
    // Fall back to the full string length so we don't break the pre-existing
    // behaviour where no cursor tracking was done.
    const endIdx = cursorIndex > 0 ? cursorIndex + 1 : whereClause.length;
    const textUpToCursor = whereClause.slice(0, endIdx);
    const match = columnValueRegex.exec(textUpToCursor);
    if (match) {
      labelMeta.focusOn = "value";
      labelMeta.isFocused = true;
      // Pick whichever capture group matched — only one will be non-null.
      labelMeta.meta.label = match[1] ?? match[2] ?? match[3] ?? match[4];
      // True when the user has already typed an opening quote, e.g. field = 'partial
      // In this case insertText should be  value'  (close only), not  'value'
      labelMeta.meta.hasOpenQuote = /'[^']*$/.test(textUpToCursor);
    }
    return labelMeta;
  }

  const getSuggestions = async () => {
    autoCompleteKeywords.value = [];

    // SearchBar sets autoCompleteData.value.cursorIndex at the top level.
    // autoCompleteData.value.position.cursorIndex is the legacy field — it
    // is never updated by SearchBar and stays 0. We read the top-level one
    // first and fall back to position.cursorIndex for safety.
    const cursorIndex =
      (autoCompleteData.value as any).cursorIndex ??
      autoCompleteData.value.position.cursorIndex;

    // Determine if the cursor is currently after an operator expecting a value.
    // If so, sqlWhereClause.meta.label is the field name (e.g. "status").
    const sqlWhereClause = analyzeSqlWhereClause(
      autoCompleteData.value.query,
      cursorIndex,
    );

    if (sqlWhereClause.meta.label) {
      const fieldName = sqlWhereClause.meta.label;

      // [EXISTING] In-session values — collected from the current session's
      // search result hits and stored in the reactive fieldValues prop.
      // These are available immediately (no async) but disappear on page reload.
      const inSessionValues = Array.from(
        autoCompleteData.value.fieldValues[fieldName] || new Set(),
      ) as string[];

      // [NEW] Persisted values — read from IndexedDB (via in-memory cache).
      // These survive page reloads and accumulate across multiple searches.
      // Guard: only query IDB if stream context is set — without org/streamType/
      // streamName we cannot build the composite key and would get empty results.
      let storedValues: string[] = [];
      if (
        autoCompleteData.value.org &&
        autoCompleteData.value.streamType &&
        autoCompleteData.value.streamName
      ) {
        storedValues = await getFieldValuesForSuggestion(
          {
            org: autoCompleteData.value.org,
            streamType: autoCompleteData.value.streamType,
            streamName: autoCompleteData.value.streamName,
          },
          fieldName,
        );
      }

      // Merge in-session + stored, deduplicate via Set.
      // inSessionValues come first so they appear at the top of the dropdown
      // (they are from the current search context, most relevant).
      // storedValues from previous sessions fill in anything not seen today.
      const merged = [...new Set([...inSessionValues, ...storedValues])];

      if (merged.length > 0) {
        const hasOpenQuote = sqlWhereClause.meta.hasOpenQuote;

        // Build Monaco suggestion items with smart quoting and sort order.
        autoCompleteKeywords.value = merged.map((item, idx) => {
          const isNumeric = item !== "" && !isNaN(Number(item));
          const isBoolean = item === "true" || item === "false";

          // Quoting rules:
          //   numeric / boolean → no quotes  (SQL: status = 200, active = true)
          //   string, open quote already typed → close only  (field = 'val → val')
          //   string, no open quote → wrap fully  (field =  → 'val')
          let insertText: string;
          if (isNumeric || isBoolean) {
            insertText = item;
          } else if (hasOpenQuote) {
            insertText = `${item}'`; // user already typed the opening '
          } else {
            insertText = `'${item}'`;
          }

          // \x01 (ASCII 1) is the lowest-sorting printable character.
          // Prefixing sortText with it ensures value suggestions always appear
          // ABOVE keywords ("and", "or", "like") and functions in the Monaco
          // dropdown, which sort by their label (starting with a letter > \x01).
          // The padded index preserves the order of values as returned from IDB.
          const sortText = `\x01${String(idx).padStart(6, "0")}`;
          return { label: item, insertText, kind: "Value", sortText };
        });

        autoCompleteData.value.popup.open(autoCompleteData.value.query);
        // Return early — do NOT fall through to updateAutoComplete().
        // We don't want keywords/fields/functions mixed into a value dropdown.
        return;
      }
    }

    // No value context detected — show the default keywords, fields, functions.
    updateAutoComplete();
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
    defaultSuggestions, // Export for use in natural language detection
  };
};

export default useSqlSuggestions;
