import { streamSchemaQuery } from "@/services/stream.queries";
import { queryClient } from "@/composables/query/queryClient";
import {
  fieldValuesUnavailable,
  getFieldValuesForSuggestion,
  requestFieldValues,
  type ValueLookupOptions,
} from "@/composables/fieldValueStore";
import { nextTick, ref } from "vue";
import { PROMQL_CATALOG } from "@/utils/query/promqlCompletion";
import { SORT_LANE } from "@/utils/query/sqlCompletion";

// Columns a metrics stream carries that are not labels. `value` is the sample,
// `_timestamp` the clock, `__hash__` internal, and `__name__` the metric the
// user has already typed — none of them belong inside `{`.
const NON_LABEL_COLUMNS = new Set(["value", "_timestamp", "__hash__", "__name__"]);

import { useStore } from "vuex";

export interface PromqlValueContext {
  metric: string;
  label: string;
  hasOpenQuote: boolean;
  typed: string;
}

export const parsePromqlValueContext = (textBeforeCursor: string): PromqlValueContext | null => {
  const open = textBeforeCursor.lastIndexOf("{");
  if (open < 0 || textBeforeCursor.lastIndexOf("}") > open) return null;
  const matcher = textBeforeCursor
    .slice(open + 1)
    .match(/(\w+)\s*(?:=~|!=|!~|=)\s*(?:"((?:[^"\\]|\\.)*)|([\w.:-]*))$/);
  if (!matcher) return null;
  // Without a metric there is no stream to read, and nothing honest to offer.
  const metric = textBeforeCursor.slice(0, open).match(/([A-Za-z_:][\w:]*)\s*$/)?.[1];
  if (!metric) return null;
  return {
    metric,
    label: matcher[1],
    hasOpenQuote: matcher[2] !== undefined,
    typed: matcher[2] ?? matcher[3] ?? "",
  };
};

export const resolvePromqlLabelValues = async (
  org: string,
  metric: string,
  label: string,
  options: ValueLookupOptions = {},
): Promise<string[]> => {
  const ctx = { org, streamType: "metrics", streamName: metric };
  const cached = await getFieldValuesForSuggestion(ctx, label).catch(() => [] as string[]);
  if (cached.length) return cached;
  const fetched = await requestFieldValues(ctx, label, options);
  if (!fetched.length && fieldValuesUnavailable(ctx, label)) {
    throw new Error("label values unavailable");
  }
  return fetched;
};

/** An auto-closed quote ahead is swallowed so the caret ends outside the string. */
export const buildPromqlValueEntries = (
  values: string[],
  {
    hasOpenQuote,
    closingQuoteAhead = false,
    range,
  }: { hasOpenQuote: boolean; closingQuoteAhead?: boolean; range?: Record<string, number> },
): any[] =>
  values.map((value, index) => {
    const literal = value.replace(/[\\"]/g, "\\$&");
    const entry: any = {
      name: value,
      label: `"${literal}"`,
      kind: "Value",
      insertText: hasOpenQuote ? `${literal}"` : `"${literal}"`,
      sortText: `\u0000${String(index).padStart(6, "0")}`,
      filterText: hasOpenQuote ? value : `"${value}"`,
    };
    if (hasOpenQuote && closingQuoteAhead && range) {
      entry.range = { ...range, endColumn: (range.endColumn ?? 1) + 1 };
    }
    return entry;
  });

const usePromqlSuggestions = () => {
  const autoCompleteData = ref({
    query: "",
    text: "",
    position: {
      cursorIndex: 0,
    },
    popup: {
      open: (_val: string) => {},
      close: (_val: string) => {},
    },
    dateTime: {
      startTime: new Date().getTime() * 1000,
      endTime: new Date().getTime() * 1000,
    },
  });
  const store = useStore();
  // Seeded, not empty: this list is otherwise only filled by getSuggestions,
  // which runs on a query update — so Ctrl+Space on a freshly opened PromQL
  // editor offered nothing at all until the user typed a character.
  const autoCompletePromqlKeywords: any = ref([...PROMQL_CATALOG]);

  // True while the list belongs to a label or value position. Metrics arriving
  // in the background must not replace such a list, and an empty result in one
  // means "nothing matches here" — not "show me the language".
  let contextualSuggestions = false;
  const metricKeywords: any = ref([]);

  const parsePromQlQuery = (query: string) => {
    const meta = {
      metricName: "" as string | null,
      label: {
        hasLabels: false,
        position: {
          start: 0,
          end: 0,
        },
        labels: {},
      },
    };
    // Extract metric name
    const metricNameMatch = query.match(/(\w+)\{/);
    const metricName = metricNameMatch ? metricNameMatch[1] : null;
    //Check if curly brace is present
    const curlyBracesRegex = /{([^{}]*?)}/;
    const curlyBracesRegexMatch = query.match(curlyBracesRegex);
    if (curlyBracesRegexMatch) {
      meta.label.hasLabels = true;
      // Get start and end position from regex return object
      meta.label.position.start = curlyBracesRegexMatch.index || 0;
      meta.label.position.end =
        (curlyBracesRegexMatch.index || 0) + curlyBracesRegexMatch[1].length + 1;
    }
    // Extract labels
    const labelsMatch = query.match(/\{(.+?)\}/);
    const labels: { [key: string]: string } = {};
    if (labelsMatch) {
      const labelsStr = labelsMatch[1];
      const labelPairs = labelsStr.match(/(\w+)="([^"]*)"/g);
      if (labelPairs?.length)
        labelPairs.forEach((pair) => {
          const matchResult = pair.match(/(\w+)="([^"]*)"/);
          const [key, value] = matchResult ? matchResult.slice(1) : [null, null];
          if (key && value) labels[key] = value;
        });
    }
    meta["label"]["labels"] = labels;
    meta["metricName"] = metricName;
    return meta;
  };

  function analyzeLabelFocus(query: string, cursorIndex: number) {
    const keyValuePairRegex = /\b(\w+)\s*=\s*("([^"]*)|,|\})/g;

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

    const curlyBracesRegex = /{([^{}]*?)}/;

    const hasCurlyBraces = curlyBracesRegex.exec(query);
    if (hasCurlyBraces) {
      labelMeta.hasLabels = true;
      labelMeta.isEmpty = !hasCurlyBraces[1].length;
      labelMeta.isFocused =
        hasCurlyBraces.index <= cursorIndex &&
        hasCurlyBraces.index + hasCurlyBraces[1].length >= cursorIndex;
    }

    if (hasCurlyBraces) {
      const start = hasCurlyBraces.index;
      const end = start + hasCurlyBraces[0].length;
      if (start <= cursorIndex && cursorIndex <= end) {
        const value = hasCurlyBraces[0][cursorIndex - start];
        const nextValue = hasCurlyBraces[0][cursorIndex - start + 1];

        // Check is value
        if ((value === '"' && nextValue !== "}") || value === "=") {
          labelMeta["focusOn"] = "value";
        }

        if (value === "{" || value === ",") {
          labelMeta["focusOn"] = "label";
        }
      }
    }

    // Extract labels
    let match;
    while (hasCurlyBraces && (match = keyValuePairRegex.exec(query)) !== null) {
      const [fullMatch, key, , value] = match;
      const start = match.index;
      const end = start + fullMatch.length;
      // Detect cursor position for labels and values
      if (start <= cursorIndex && cursorIndex <= end) {
        if (cursorIndex - start < key.length) {
          labelMeta["focusOn"] = "label";
        } else if (key && value && cursorIndex - start < key.length + value.length) {
          labelMeta["focusOn"] = "value";
        }

        labelMeta["meta"]["label"] = key;
        labelMeta["meta"]["value"] = value;

        break;
      }
    }

    // Handle unclosed braces: cursor is after a { with no matching } yet.
    // The closed-brace regex above won't match in this case, leaving
    // isFocused=false and causing stream names to appear instead of labels.
    if (!labelMeta.isFocused) {
      const textUpToCursor = query.substring(0, cursorIndex + 1);
      const lastOpen = textUpToCursor.lastIndexOf("{");
      if (lastOpen !== -1 && textUpToCursor.lastIndexOf("}") < lastOpen) {
        labelMeta.hasLabels = true;
        labelMeta.isFocused = true;
        const content = textUpToCursor.substring(lastOpen + 1);
        labelMeta.isEmpty = content.length === 0;

        // Value context: label name followed by any PromQL matcher (=, !=, =~, !~)
        // with an optional partial quoted value
        const valueMatch = content.match(/(\w+)\s*(?:=~|!=|!~|=)(?:"[^"]*)?$/);
        if (valueMatch) {
          labelMeta.focusOn = "value";
          labelMeta.meta.label = valueMatch[1];
        } else {
          // Label context: right after { or after a comma
          labelMeta.focusOn = "label";
        }
      }
    }

    return labelMeta;
  }

  // Bumped by every suggestion pass. A lookup that finishes after a newer one
  // started has been overtaken and must not publish: values are a network call
  // with a ten-second ceiling, so `{service="` can easily answer after the user
  // has moved on to `{region="`.
  let suggestionGeneration = 0;

  const getSuggestions = async () => {
    const generation = ++suggestionGeneration;
    const isCurrent = () => generation === suggestionGeneration;
    try {
      const parsedQuery: any = parsePromQlQuery(autoCompleteData.value.query);
      const metricName = parsedQuery?.metricName || "";
      const labels = parsedQuery?.label?.labels || {};

      // The list is NOT cleared here. Two of the branches below return without
      // refilling it, and an empty list is never the better answer: the catalog
      // is the floor.
      //
      // The dateTime range went with the series call. The lookups that replaced
      // it carry their own windows — the schema has none to carry, and the
      // value fetch uses its own recent-values window.
      if (metricName) labels["__name__"] = metricName;

      const formattedLabels = Object.keys(labels).map((key) => {
        return `${key}="${labels[key]}"`;
      });

      const cursorIndex = autoCompleteData.value.position.cursorIndex;

      const labelFocus: any = analyzeLabelFocus(autoCompleteData.value.query, cursorIndex);

      if (cursorIndex === -1) return;

      if (!labelFocus.isFocused) {
        updatePromqlKeywords([]);
        return;
      }

      // Values belong to the completion provider: a popup opened from here is always highlighted, and Enter would insert one.
      if (labelFocus.focusOn !== "label") return;
      // Without a metric name there is no stream to read and nothing honest to offer.
      if (!metricName) return;

      const org = store.state.selectedOrganization.identifier;

      autoCompletePromqlKeywords.value = [
        {
          label: "...Loading",
          insertText: "",
          kind: "Text",
        },
      ];
      autoCompleteData.value.popup.open(autoCompleteData.value.text);

      // The schema, not /series: it is metadata (no scan) and a third of the bytes.
      try {
        // The query is the cache: keyed per org and metric, and it expires.
        const response: any = await queryClient.fetchQuery(
          streamSchemaQuery(org, metricName, "metrics"),
        );
        const columns = response?.schema ?? response?.uds_schema ?? [];
        const labels: string[] = columns
          .map((column: any) => column?.name)
          .filter((name: string) => name && !NON_LABEL_COLUMNS.has(name));

        if (!isCurrent()) return;

        const alreadyFiltered = formattedLabels.join(",");
        updatePromqlKeywords(
          labels
            .filter((name) => alreadyFiltered.indexOf(`${name}=`) === -1)
            .map((name) => ({
              label: name,
              kind: "Variable",
              // Users type the `=` themselves, and Monaco does not dedupe it into `==`.
              insertText: name,
            })),
          { contextual: true },
        );
      } catch {
        // The labels are unavailable; the language is not.
        if (!isCurrent()) return;
        updatePromqlKeywords([]);
        autoCompleteData.value.popup.close("");
      }
    } catch (e) {
      console.log(e);
    }
  };

  const getLabelSuggestions = (labels: any[], meta: any, queryLabels: any) => {
    const keywords: any = [];
    const keywordLabels: any = [];
    if (meta.focusOn === "label")
      Object.keys(labels[0] || {}).forEach((key) => {
        if (queryLabels.indexOf(key + "=") === -1)
          keywords.push({
            label: key,
            kind: "Variable",
            insertText: key + "=",
          });
      });

    if (meta.focusOn === "value")
      labels.forEach((label: any) => {
        if (label[meta.meta.label] && keywordLabels.indexOf(label[meta.meta.label]) === -1) {
          keywordLabels.push(label[meta.meta.label]);
          keywords.push({
            label: label[meta.meta.label],
            kind: "Variable",
            insertText: `"${label[meta.meta.label]}"`,
          });
        }
      });
    return keywords;
  };

  /** The default list: the language, plus this org's metrics above it. */
  const rebuildBaseSuggestions = () => {
    autoCompletePromqlKeywords.value = [...PROMQL_CATALOG, ...metricKeywords.value];
    contextualSuggestions = false;
  };

  const updatePromqlKeywords = async (
    data: any[],
    { contextual = false }: { contextual?: boolean } = {},
  ) => {
    if (contextual) {
      // Verbatim, INCLUDING an empty list. A label lookup that matched nothing
      // and a plain request for the catalog both arrive as [], and treating
      // them the same put 97 function names inside `up{instance="`, where not
      // one of them can be typed.
      autoCompletePromqlKeywords.value = [...data];
      contextualSuggestions = true;
    } else if (data.length) {
      autoCompletePromqlKeywords.value = [...data];
      contextualSuggestions = true;
    } else {
      rebuildBaseSuggestions();
    }

    await nextTick();
    autoCompleteData.value.popup.open("");
  };

  const updateMetricKeywords = (metrics: any[]) => {
    metricKeywords.value = [];
    metrics.forEach((metric: any) => {
      metricKeywords.value.push({
        label: metric.label + (metric.type ? `(${metric.type})` : ""),
        kind: "Variable",
        insertText: metric.label,
        // The field lane. A metric is what the user came to type; behind 107
        // catalog entries is the same as not offering it.
        sortText: SORT_LANE.field + metric.label,
      });
    });

    // Rebuild what is on offer, because these arrive from a watcher AFTER the
    // list was seeded — without this a freshly opened editor showed the whole
    // catalog and not one metric name until the user edited the query. Not
    // while a label or value list is showing, and never by opening the widget:
    // this is a refresh, not an invitation.
    if (!contextualSuggestions) rebuildBaseSuggestions();
  };

  return {
    autoCompleteData,
    autoCompletePromqlKeywords,
    getSuggestions,
    updateMetricKeywords,
    parsePromQlQuery,
    analyzeLabelFocus,
    getLabelSuggestions,
    updatePromqlKeywords,
    metricKeywords,
  };
};

export default usePromqlSuggestions;
