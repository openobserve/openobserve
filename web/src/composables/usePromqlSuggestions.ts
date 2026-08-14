import streamService from "@/services/stream";
import { getFieldValuesForSuggestion, requestFieldValues } from "@/composables/fieldValueStore";
import { nextTick, ref } from "vue";
import { PROMQL_CATALOG } from "@/utils/query/promqlCompletion";
import { SORT_LANE } from "@/utils/query/sqlCompletion";

// Columns a metrics stream carries that are not labels. `value` is the sample,
// `_timestamp` the clock, `__hash__` internal, and `__name__` the metric the
// user has already typed — none of them belong inside `{`.
const NON_LABEL_COLUMNS = new Set(["value", "_timestamp", "__hash__", "__name__"]);

// One schema per metric per page, shared by every editor. A metrics stream is
// named for its metric, so this is also the label list.
//
// Keyed by ORGANISATION and metric, because organisations are switched in place
// in this SPA and metric names are not unique across them — the field-value
// cache is scoped the same way, for the same reason.
const metricLabelCache = new Map<string, string[]>();
const metricLabelCacheKey = (org: string, metric: string) => `${org}|${metric}`;
import { useStore } from "vuex";

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

      if (!(labelFocus.focusOn === "value" || labelFocus.focusOn === "label")) return;
      // Both lookups are scoped to one metric; without a metric name there is
      // no stream to read and nothing honest to offer.
      if (!metricName) return;

      const org = store.state.selectedOrganization.identifier;
      const streamCtx = { org, streamType: "metrics", streamName: metricName };

      autoCompletePromqlKeywords.value = [
        {
          label: "...Loading",
          insertText: "",
          kind: "Text",
        },
      ];
      autoCompleteData.value.popup.open(autoCompleteData.value.text);

      if (labelFocus.focusOn === "label") {
        // The SCHEMA, not the series. `/series` returns every matching series
        // with all of its labels for the client to dedupe — 5903 bytes where
        // the schema answers in 1699, and it is metadata, so no scan at all.
        try {
          const cacheKey = metricLabelCacheKey(org, metricName);
          let labels = metricLabelCache.get(cacheKey);
          if (!labels) {
            const response: any = await streamService.schema(org, metricName, "metrics");
            const columns = response?.data?.schema ?? response?.data?.uds_schema ?? [];
            labels = columns
              .map((column: any) => column?.name)
              .filter((name: string) => name && !NON_LABEL_COLUMNS.has(name));
            metricLabelCache.set(cacheKey, labels as string[]);
          }

          if (!isCurrent()) return;

          const alreadyFiltered = formattedLabels.join(",");
          updatePromqlKeywords(
            (labels as string[])
              .filter((name) => alreadyFiltered.indexOf(`${name}=`) === -1)
              .map((name) => ({
                label: name,
                kind: "Variable",
                // The bare name, without an `=`.
                //
                // Appending the operator reads like a convenience, but the
                // habit it collides with is typing `=` yourself: accepting
                // `environment` and then typing `=` gives `environment==`,
                // which matches nothing and offers nothing. Monaco does not
                // dedupe the operator, so the safe insert is the name alone.
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
        return;
      }

      // Label VALUES are field values of the metric's stream — the same cache,
      // the same key, the same on-demand fetch the SQL editors use.
      const labelName = labelFocus.meta.label;
      let values: string[] = [];
      try {
        values = await getFieldValuesForSuggestion(streamCtx, labelName);
        if (!values.length) values = await requestFieldValues(streamCtx, labelName);
      } catch {
        values = [];
      }

      if (!isCurrent()) return;

      // Quoting, decided from what is actually around the cursor. Monaco
      // auto-closes `"`, so the model is `service=""` with the cursor between
      // them; inserting a fully quoted value there produced
      // `service=""api-gateway""`.
      const textBeforeCursor = autoCompleteData.value.query.slice(0, cursorIndex + 1);
      const textAfterCursor = autoCompleteData.value.query.slice(cursorIndex + 1);
      const hasOpeningQuote = /"[^"]*$/.test(textBeforeCursor);
      const hasClosingQuote = textAfterCursor.startsWith('"');

      updatePromqlKeywords(
        values.map((value) => ({
          label: value,
          kind: "Variable",
          insertText: hasOpeningQuote ? (hasClosingQuote ? value : `${value}"`) : `"${value}"`,
        })),
        { contextual: true },
      );
      // Nothing matched: take the widget away rather than leaving an empty box
      // hanging over the query.
      if (!values.length) autoCompleteData.value.popup.close("");
      return;
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
