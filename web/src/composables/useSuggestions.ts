import { queryFunctionsQuery } from "@/services/query_functions.queries";
import { queryClient } from "@/composables/query/queryClient";
import { ref, computed } from "vue";
import { useStore } from "vuex";
import {
  FIELD_VALUES_REQUEST_SIZE,
  fieldValuesUnavailable,
  getFieldValuesForSuggestion,
  noValueLookup,
  pendingFieldValues,
  requestFieldValues,
  requestFieldValuesMatching,
  type FieldValuesTimeRange,
  type StreamContext,
  type ValueLookupOptions,
} from "@/composables/fieldValueStore";
import {
  SQL_KEYWORDS,
  SQL_CLAUSE_KEYWORDS,
  SQL_FUNCTIONS,
  buildFieldEntry,
} from "@/utils/query/sqlCompletion";
import { mergeServerFunctions } from "@/utils/query/serverFunctions";
import { type ServerQueryFunction } from "@/services/query_functions";
import { MAX_VALUE_LENGTH } from "@/utils/fieldValueUtils";

// Under the editor's 1 s value budget, so local values still beat the still-loading row.
const LOCAL_VALUES_SERVER_WAIT_MS = 800;
const PREFIX_ENOUGH_MATCHES = 3;

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
  // Bumped whenever the catalog is superseded, so a late response from an
  // earlier request cannot overwrite newer state.
  let requestSeq = 0;

  const setServerFunctions = (functions: ServerQueryFunction[] | null | undefined) => {
    serverFunctions.value = Array.isArray(functions) ? functions : [];
    // An explicit set means the caller has supplied the catalog for this org;
    // marking it fetched stops the lazy loader from clearing it out again on
    // the next suggestion pass, and bumping the sequence makes any request
    // already in the air discard its result instead of overwriting this one.
    fetchedOrg =
      autoCompleteData.value.org || store.state.selectedOrganization?.identifier || fetchedOrg;
    requestSeq += 1;
    updateAutoComplete();
  };

  const ensureServerFunctions = async () => {
    // Fall back to the store's org. Surfaces that only wire up field keywords —
    // the SLO form does exactly that — never populate autoCompleteData.org, and
    // requiring them to would be one more thing a caller must remember.
    const org = autoCompleteData.value.org || store.state.selectedOrganization?.identifier;
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
    requestSeq += 1;
    const seq = requestSeq;

    // Cached: reopening the editor for the same org inside the tier's staleTime
    // costs nothing. The org/sequence guards below still matter — they cover a
    // fast org switch, which the cache key alone would not sequence.
    inFlight = queryClient
      .fetchQuery(queryFunctionsQuery(org))
      .then((list: any[]) => {
        // Discard if the org changed, or if the catalog was superseded while we
        // were waiting (setServerFunctions, or a newer request).
        if (fetchedOrg !== org || seq !== requestSeq) return;
        serverFunctions.value = Array.isArray(list) ? list : [];
      })
      .catch(() => {
        // The local catalog is still perfectly usable; a failed lookup must not
        // take autocomplete down with it.
        if (fetchedOrg === org && seq === requestSeq) serverFunctions.value = [];
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

  const readStreamContext = (): StreamContext | null => {
    const { org, streamType, streamName } = autoCompleteData.value;
    return org && streamType && streamName ? { org, streamType, streamName } : null;
  };

  const sameStreamContext = (a: StreamContext, b: StreamContext | null): boolean =>
    !!b && a.org === b.org && a.streamType === b.streamType && a.streamName === b.streamName;

  // Null means the default fifteen-minute lookback; a dashboard panel sets its own range.
  let valuesTimeRange: FieldValuesTimeRange | null = null;

  const setValuesTimeRange = (range: { startTime: number; endTime: number } | null): void => {
    const valid =
      !!range &&
      Number.isFinite(range.startTime) &&
      Number.isFinite(range.endTime) &&
      range.startTime < range.endTime;
    valuesTimeRange = valid ? { startTime: range.startTime, endTime: range.endTime } : null;
  };

  const lookupUnchanged = (ctx: StreamContext, range: FieldValuesTimeRange | null): boolean =>
    sameStreamContext(ctx, readStreamContext()) &&
    range?.startTime === valuesTimeRange?.startTime &&
    range?.endTime === valuesTimeRange?.endTime;

  // Resolves to null when the server misses the wait, so local values are not held back by it.
  const withinServerWait = (lookup: Promise<string[]>, ms: number): Promise<string[] | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), Math.max(0, ms));
    });
    return Promise.race([lookup, wait]).finally(() => clearTimeout(timer));
  };

  // Only a truncated top list can be hiding matches, and a few matches already make a useful menu.
  const needsPrefixLookup = (prefix: string, fetched: string[] | null, merged: string[]) => {
    if (!fetched || fetched.length < FIELD_VALUES_REQUEST_SIZE) return false;
    const lower = prefix.toLowerCase();
    const matches = merged.filter((v) => v.toLowerCase().startsWith(lower)).length;
    return matches < PREFIX_ENOUGH_MATCHES;
  };

  /** Field values for one column: in-session first, then stored, then the server's, deduplicated. */
  const resolveFieldValues = async (
    fieldName: string,
    options: ValueLookupOptions = {},
  ): Promise<string[]> => {
    // Search hits put raw values here, null and numbers included, and the menu works on text.
    const inSession = (
      Array.from(autoCompleteData.value.fieldValues?.[fieldName] || new Set()) as unknown[]
    )
      .filter((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
      .map(String)
      // Dropped, not cut short: a truncated value would insert a filter that matches nothing.
      .filter((v) => v.length <= MAX_VALUE_LENGTH);
    const ctx = readStreamContext();
    if (!ctx) {
      if (inSession.length) return inSession;
      throw noValueLookup();
    }
    const range = valuesTimeRange;

    let stored: string[] = [];
    // Persisted values come from any window, so a caller with its own range does not get them.
    if (!range) {
      try {
        stored = await getFieldValuesForSuggestion(ctx, fieldName);
      } catch {
        // A failed lookup must not take completion down with it.
        stored = [];
      }
    }

    // The stream can change while a lookup is awaited, and the menu must show the current stream's values.
    if (!lookupUnchanged(ctx, range)) return resolveFieldValues(fieldName, options);
    const local = [...new Set([...inSession, ...stored])];

    const { prefix: typed = "", ...lookupOptions } = options;
    const serverOptions = { ...lookupOptions, ...(range ? { timeRange: range } : {}) };
    const deadline = Date.now() + LOCAL_VALUES_SERVER_WAIT_MS;
    const awaitServer = (lookup: Promise<string[]>) =>
      local.length ? withinServerWait(lookup, deadline - Date.now()) : lookup;

    // Recent values on screen are a thin sample, so the server is asked even when there are some.
    let fetched = await awaitServer(requestFieldValues(ctx, fieldName, serverOptions));
    const slow =
      !local.length && !fetched?.length && pendingFieldValues(ctx, fieldName, serverOptions);
    // Still answering is not "no values": staying pending lets the editor show its loading row.
    if (slow) fetched = await slow;
    if (!lookupUnchanged(ctx, range)) return resolveFieldValues(fieldName, options);
    let merged = [...new Set([...local, ...(fetched ?? [])])];

    const prefix = typed.trim();
    if (prefix && needsPrefixLookup(prefix, fetched, merged)) {
      const matching = requestFieldValuesMatching(ctx, fieldName, prefix, serverOptions);
      const matched = await awaitServer(matching);
      if (!lookupUnchanged(ctx, range)) return resolveFieldValues(fieldName, options);
      merged = [...new Set([...merged, ...(matched ?? [])])];
    }
    if (!merged.length && fieldValuesUnavailable(ctx, fieldName, range)) {
      throw new Error("field values unavailable");
    }
    return merged;
  };

  /**
   * Context suggestions the PARENT still owns: stream names after FROM.
   *
   * Field VALUES used to be resolved here too — the same lookup this file's
   * resolveFieldValues does — and then pushed down as contextKeywords with a
   * forced popup.open. The completion provider now awaits the resolver inline
   * (C4), so keeping that branch meant every value edit did the lookup twice
   * and re-opened the widget on top of a list it had already produced. The
   * provider is the only value path now.
   */
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

    // Compute text up to cursor, so the FROM regex anchors at the cursor rather
    // than at the end of the query.
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
    // Kick the catalog load from here too: getSuggestions is not called by every
    // surface (the SLO form only calls updateFieldKeywords), so hanging the
    // fetch off it alone left those pages with the local functions only.
    // Guarded by fetchedOrg, so this is a no-op after the first call.
    void ensureServerFunctions();

    // The server knows which functions aggregate, including the local catalog's own count or avg.
    const aggregates = new Set(
      (serverFunctions.value as any[])
        .filter((f: any) => f?.kind === "aggregate" || f?.kind === "window")
        .map((f: any) => String(f.name).toLowerCase()),
    );
    autoCompleteSuggestions.value = mergeServerFunctions(
      defaultSuggestions,
      (serverFunctions.value as any[]).filter(
        (f: any) => !alreadyOffered.has(String(f?.name).toLowerCase()),
      ),
    ).map((entry) =>
      aggregates.has(entry.name.toLowerCase()) ? { ...entry, aggregate: true } : entry,
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
    resolveFieldValues,
    setValuesTimeRange,
    defaultSuggestions, // Export for use in natural language detection
  };
};

export default useSqlSuggestions;
