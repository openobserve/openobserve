import { ref, computed } from "vue";
import { useStore } from "vuex";
import { getFieldValuesForSuggestion } from "@/composables/useFieldValueStore";
import {
  SQL_KEYWORDS,
  SQL_CLAUSE_KEYWORDS,
  SQL_FUNCTIONS,
  buildFieldEntry,
} from "@/utils/query/sqlCompletion";
import { mergeServerFunctions } from "@/utils/query/serverFunctions";
import queryFunctions, { type ServerQueryFunction } from "@/services/query_functions";

const useSqlSuggestions = () => {
  // Both lists come from the shared catalog (web/src/utils/query/sqlCompletion.ts).
  // They used to be declared inline here AND in CodeQueryEditor.vue, and the two
  // copies had already drifted (7 entries vs 26).
  // Predicates + structural SQL. Clause keywords are NOT gated on SQL mode:
  // the Logs filter-fragment mode edits a WHERE clause but users still compose
  // full queries there.
  const defaultKeywords = [...SQL_KEYWORDS, ...SQL_CLAUSE_KEYWORDS];
  const defaultSuggestions = SQL_FUNCTIONS;

  const autoCompleteData = ref({
    fieldValues: {} as any, // { kubernetes_host: new Set([value1, value2]) }
    query: "",
    // Top-level cursor index (set by SearchBar / query editors); read first, with
    // position.cursorIndex kept as a legacy fallback.
    cursorIndex: undefined as number | undefined,
    position: {
      cursorIndex: 0,
    },
    popup: {
      open: (_val: string) => {},
      close: (_val: string) => {},
    },
    // Stream context — set by SearchBar.vue when a stream is selected.
    // Required to build the composite IDB key: "org|streamType|streamName|fieldName".
    // Without these three, getFieldValuesForSuggestion cannot look up stored values.
    org: "",
    streamType: "",
    streamName: "",
  });
  const autoCompleteSuggestions: any = ref([]);
  const loading = ref(false);
  // Base keywords — always reflects fields + functions + defaults.
  // Maintained exclusively by updateAutoComplete(); never overwritten by
  // getSuggestions() context branches.
  const autoCompleteKeywords: any = ref([]);
  const store = useStore();
  const functionKeywords: any = ref([]);
  let fieldKeywords: any = [];
  const streamKeywords: any = ref([]);

  // Context-specific override keywords (streams in FROM context, field values
  // after an operator).  Non-empty while the user is inside such a context.
  // Cleared back to [] in the normal branch of getSuggestions().
  const contextKeywords: any = ref([]);

  // Server-supplied functions, merged over the local catalog. Fetched lazily on
  // the first suggestion pass for an org and cached until the org changes, so
  // no component has to remember to load them.
  const serverFunctions: any = ref([]);
  let fetchedOrg: string | null = null;
  let inFlight: Promise<void> | null = null;

  const setServerFunctions = (functions: ServerQueryFunction[] | null | undefined) => {
    serverFunctions.value = Array.isArray(functions) ? functions : [];
    // An explicit set means the caller has supplied the catalog for this org;
    // marking it fetched stops the lazy loader from clearing it out again on
    // the next suggestion pass.
    fetchedOrg = autoCompleteData.value.org || fetchedOrg;
    updateAutoComplete();
  };

  const ensureServerFunctions = async () => {
    const org = autoCompleteData.value.org;
    if (!org) return;
    // Already handled for this org — but if its request is still in the air,
    // await THAT one rather than returning early with an empty list.
    if (org === fetchedOrg) return inFlight ?? undefined;
    // A request for a DIFFERENT org is in the air. Do not return it: awaiting
    // another org's fetch would leave this org unfetched for the whole pass.
    // Falling through starts the correct request; the stale one is discarded by
    // the fetchedOrg check in its own handlers.

    // Drop the previous org's entries BEFORE awaiting: otherwise the first
    // popup after switching still shows the old tenant's function names.
    serverFunctions.value = [];
    fetchedOrg = org;

    inFlight = queryFunctions
      .list(org)
      .then((res: any) => {
        // Only apply if the org has not changed again while we were waiting.
        if (fetchedOrg !== org) return;
        serverFunctions.value = Array.isArray(res?.data?.list) ? res.data.list : [];
      })
      .catch(() => {
        // The local catalog is still perfectly usable; a failed lookup must not
        // take autocomplete down with it.
        if (fetchedOrg === org) serverFunctions.value = [];
      })
      .finally(() => {
        inFlight = null;
        updateAutoComplete();
      });

    return inFlight;
  };

  // What the editor actually receives:
  //   - contextKeywords when non-empty (FROM / value context)
  //   - autoCompleteKeywords otherwise (field / function / SQL keywords)
  // This lets watchers freely update autoCompleteKeywords without disturbing
  // an active context dropdown, and the transition back to normal keywords is
  // instant the moment getSuggestions() exits the context branch.
  const effectiveKeywords = computed(() =>
    contextKeywords.value.length ? contextKeywords.value : autoCompleteKeywords.value,
  );
  const effectiveSuggestions = computed(() =>
    contextKeywords.value.length ? [] : autoCompleteSuggestions.value,
  );

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
    // Slice the WHERE clause up to (and including) the cursor position.
    // Fall back to full string length only when cursorIndex is negative,
    // which indicates no cursor tracking (e.g. called without a position).
    const endIdx = cursorIndex >= 0 ? cursorIndex + 1 : whereClause.length;
    const textUpToCursor = whereClause.slice(0, endIdx);
    const match = columnValueRegex.exec(textUpToCursor);
    if (match) {
      labelMeta.focusOn = "value";
      labelMeta.isFocused = true;
      // Pick whichever capture group matched — only one will be non-null.
      labelMeta.meta.label = match[1] ?? match[2] ?? match[3] ?? match[4];
      // True when the user has already typed an opening quote, e.g. field = 'partial
      // In this case insertText should be  value'  (close only), not  'value'
      //
      // Scope the check to the text starting at the current match, not the full
      // query. A closed quote from a preceding condition (e.g. http = 'te') has
      // no trailing non-quote chars after it until cursor, which would otherwise
      // make /'[^']*$/ fire and wrongly set hasOpenQuote for the new condition.
      labelMeta.meta.hasOpenQuote = /'[^']*$/.test(textUpToCursor.slice(match.index));
    }
    return labelMeta;
  }

  const getSuggestions = async () => {
    // Awaited so the server functions are present on the FIRST popup, not the
    // next keystroke.
    await ensureServerFunctions();
    // SearchBar sets autoCompleteData.value.cursorIndex at the top level.
    // autoCompleteData.value.position.cursorIndex is the legacy field — it
    // is never updated by SearchBar and stays 0. We read the top-level one
    // first and fall back to position.cursorIndex for safety.
    const cursorIndex =
      (autoCompleteData.value as any).cursorIndex ?? autoCompleteData.value.position.cursorIndex;

    // Compute text up to cursor (same slice logic used by analyzeSqlWhereClause).
    const query = autoCompleteData.value.query;
    const endIdx = cursorIndex >= 0 ? cursorIndex + 1 : query.length;
    let textUpToCursor = query.slice(0, endIdx);
    // CodeQueryEditor.vue emits getValue().trim(), which strips trailing
    // whitespace. When the cursor (tracked against Monaco's un-trimmed model)
    // sits at or past the end of the trimmed query, the user likely just typed
    // a space that was stripped. Re-append one space so that the FROM-context
    // regex (which requires \s+ after FROM) can still fire correctly.
    if (cursorIndex >= query.length && query.length > 0) {
      textUpToCursor = textUpToCursor + " ";
    }

    // FROM context: when the cursor is immediately after FROM (and optionally a
    // partial stream name), show stream suggestions instead of field/function
    // suggestions. This avoids confusion between stream names and field names.
    //
    // Regex: \bFROM\s+("?)(\w*)$
    //   - group 1: optional opening double-quote (handles  FROM "stream  syntax)
    //   - group 2: partial stream name being typed
    //   - $ anchored at cursor — does NOT match once additional tokens follow
    //     the stream name (e.g. WHERE clause after a complete stream name)
    //
    // When an opening quote is detected, the insertText closes it automatically
    // so the result is  FROM "stream_name"  rather than  FROM "stream_name.
    const fromMatch = /\bFROM\s+("?)([\w-]*)$/i.exec(textUpToCursor);
    if (streamKeywords.value.length > 0) {
      if (fromMatch) {
        const hasOpenQuote = fromMatch[1] === '"';
        // Monaco auto-closes " → "". When the cursor sits between the two quotes,
        // query[endIdx] is already the closing " that Monaco inserted.
        // In that case we must NOT append another " or the result will be "stream"".
        const charAfterCursor = query[endIdx] ?? "";
        const hasTrailingQuote = charAfterCursor === '"';
        contextKeywords.value = streamKeywords.value.map((kw: any) => ({
          ...kw,
          insertText: hasOpenQuote && !hasTrailingQuote ? kw.label + '"' : kw.label,
        }));
        autoCompleteData.value.popup.open?.(autoCompleteData.value.query);
        return;
      }
    }

    // Determine if the cursor is currently after an operator expecting a value.
    // If so, sqlWhereClause.meta.label is the field name (e.g. "status").
    const sqlWhereClause = analyzeSqlWhereClause(autoCompleteData.value.query, cursorIndex);

    if (sqlWhereClause.meta.label) {
      const fieldName = sqlWhereClause.meta.label;

      // In-session values — collected from the current session's
      // search result hits and stored in the reactive fieldValues prop.
      // These are available immediately (no async) but disappear on page reload.
      const inSessionValues = Array.from(
        autoCompleteData.value.fieldValues[fieldName] || new Set(),
      ) as string[];

      // Persisted values — read from IndexedDB (via in-memory cache).
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
        contextKeywords.value = merged.map((item, idx) => {
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

        autoCompleteData.value.popup.open?.(autoCompleteData.value.query);
        // Return early — do NOT fall through to updateAutoComplete().
        // We don't want keywords/fields/functions mixed into a value dropdown.
        return;
      }
    }

    // Normal context — clear the context override so effectiveKeywords falls
    // back to autoCompleteKeywords (fields + functions + SQL keywords).
    contextKeywords.value = [];
    updateAutoComplete();
  };

  const updateAutoComplete = () => {
    // Rebuild base keywords from the latest field/function/default lists.
    // Does NOT touch contextKeywords — effectiveKeywords handles the switch.
    //
    // Sort order via sortText prefixes (Monaco sorts alphabetically by sortText):
    //   \x00 — fields    (appear first — most relevant while writing SELECT/WHERE)
    //   \x01 — functions (appear second)
    //   \x02 — SQL keywords like AND, OR, LIKE, operators (appear last)
    autoCompleteKeywords.value = [];
    for (const item of fieldKeywords) {
      autoCompleteKeywords.value.push(item);
    }
    autoCompleteKeywords.value.push(...functionKeywords.value);
    // Entries carry their own sortText lane (see SORT_LANE), so nothing is
    // reassigned here — predicates and clauses would otherwise collapse into
    // one lane and interleave.
    autoCompleteKeywords.value.push(...defaultKeywords);
    // The org's own VRL transforms reach the editor through functionKeywords
    // above (the `keywords` prop). The server catalog reports the same
    // transforms, and monaco concatenates keywords with suggestions — so
    // without this filter every org function is offered twice, by two entries
    // that disagree on quoting. The keywords path wins: its argument quoting is
    // what has always shipped.
    const alreadyOffered = new Set(
      functionKeywords.value.map((f: any) => String(f.label).toLowerCase()),
    );
    autoCompleteSuggestions.value = mergeServerFunctions(
      defaultSuggestions,
      (serverFunctions.value as any[]).filter(
        (f: any) => !alreadyOffered.has(String(f?.name).toLowerCase()),
      ),
    );
  };

  // Shared helper — builds the field keyword array from a fields list,
  // excluding the timestamp column. Used by both updateFieldKeywords and
  // updateAllKeywords to avoid duplicating the mapping logic.
  const buildFieldKeywords = (fields: any[]) =>
    fields
      .filter((f) => f.name !== store.state.zoConfig.timestamp_column)
      // buildFieldEntry carries the column type into `detail`; it used to be
      // dropped on the floor even though every caller already supplies it.
      .map((f) => buildFieldEntry(f));

  const updateFieldKeywords = (fields: any[]) => {
    fieldKeywords = buildFieldKeywords(fields);
    updateAutoComplete();
  };

  // Single-pass update for both fields and functions — calls updateAutoComplete()
  // only once instead of twice, avoiding redundant keyword array rebuilds.
  const updateAllKeywords = (fields: any[], functions: any[]) => {
    fieldKeywords = buildFieldKeywords(fields);
    functionKeywords.value = functions.map((fn: any) => ({
      label: fn.name,
      kind: "Function",
      insertText: fn.name + fn.args,
      insertTextRules: "InsertAsSnippet",
      sortText: "\x01" + fn.name,
    }));
    updateAutoComplete();
  };

  const updateStreamKeywords = (streams: { name: string }[]) => {
    streamKeywords.value = streams.map((stream) => ({
      label: stream.name,
      kind: "Variable",
      insertText: stream.name,
      sortText: "\x00" + stream.name,
    }));
  };

  const updateFunctionKeywords = (functions: any[]) => {
    functionKeywords.value = [];
    functions.forEach((field: any) => {
      functionKeywords.value.push({
        label: field.name,
        kind: "Function",
        insertText: field.name + field.args,
        insertTextRules: "InsertAsSnippet",
        sortText: "\x01" + field.name,
      });
    });
    updateAutoComplete();
  };

  return {
    autoCompleteData,
    autoCompleteKeywords,
    autoCompleteSuggestions,
    effectiveKeywords,
    effectiveSuggestions,
    loading,
    getSuggestions,
    updateFieldKeywords,
    updateFunctionKeywords,
    updateAllKeywords,
    updateStreamKeywords,
    setServerFunctions,
    defaultSuggestions, // Export for use in natural language detection
  };
};

export default useSqlSuggestions;
