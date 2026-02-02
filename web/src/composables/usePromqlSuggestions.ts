import searchService from "@/services/search";
import { nextTick, ref } from "vue";
import { useStore } from "vuex";

const usePromqlSuggestions = () => {
  const autoCompleteData = ref({
    query: "",
    text: "",
    position: {
      cursorIndex: 0,
    },
    popup: {
      open: (val: string) => {},
      close: (val: string) => {},
    },
    dateTime: {
      startTime: new Date().getTime() * 1000,
      endTime: new Date().getTime() * 1000,
    },
  });
  const store = useStore();
  const autoCompletePromqlKeywords: any = ref([]);
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
        (curlyBracesRegexMatch.index || 0) +
        curlyBracesRegexMatch[1].length +
        1;
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
          const [key, value] = matchResult
            ? matchResult.slice(1)
            : [null, null];
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
        hasCurlyBraces.index <= (cursorIndex) &&
        hasCurlyBraces.index + hasCurlyBraces[1].length >= (cursorIndex);
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
      const [fullMatch, key, val, value] = match;
      const start = match.index;
      const end = start + fullMatch.length;
      // Detect cursor position for labels and values
      if (start <= cursorIndex && cursorIndex <= end) {
        if (cursorIndex - start < key.length) {
          labelMeta["focusOn"] = "label";
        } else if (
          key &&
          value &&
          cursorIndex - start < key.length + value.length
        ) {
          labelMeta["focusOn"] = "value";
        }

        labelMeta["meta"]["label"] = key;
        labelMeta["meta"]["value"] = value;

        break;
      }
    }

    return labelMeta;
  }

  const getSuggestions = async () => {
    try {
      const parsedQuery: any = parsePromQlQuery(autoCompleteData.value.query);
      const metricName = parsedQuery?.metricName || "";
      const labels = parsedQuery?.label?.labels || {};

      autoCompletePromqlKeywords.value = [];
      const startISOTimestamp: any = autoCompleteData.value.dateTime.startTime;
      const endISOTimestamp: any = autoCompleteData.value.dateTime.endTime;
      // import search service and call search.get_promql_series
      if (metricName) labels["__name__"] = metricName;

      const formattedLabels = Object.keys(labels).map((key) => {
        return `${key}="${labels[key]}"`;
      });

      const cursorIndex = autoCompleteData.value.position.cursorIndex;

      const labelFocus: any = analyzeLabelFocus(
        autoCompleteData.value.query,
        cursorIndex
      );

      if (cursorIndex === -1) return;

      if (!labelFocus.isFocused) {
        updatePromqlKeywords([]);
        return;
      }


      if (!(labelFocus.focusOn === "value" || labelFocus.focusOn === "label"))
        return;

      let labelSuggestions: any;

      autoCompletePromqlKeywords.value.push({
        label: "...Loading",
        insertText: "",
        kind: "Text",
      });

      autoCompleteData.value.popup.open(autoCompleteData.value.text);

      searchService
        .get_promql_series({
          org_identifier: store.state.selectedOrganization.identifier,
          labels: `{${formattedLabels.join(",")}}`,
          start_time: startISOTimestamp,
          end_time: endISOTimestamp,
        })
        .then((response: any) => {
          labelSuggestions = getLabelSuggestions(
            response.data.data,
            labelFocus,
            formattedLabels.join(",")
          );
        })
        .finally(() => {
          if (labelSuggestions) updatePromqlKeywords(labelSuggestions);
          else {
            autoCompletePromqlKeywords.value = [];
            autoCompleteData.value.popup.close("");
          }
        });
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
        if (
          label[meta.meta.label] &&
          keywordLabels.indexOf(label[meta.meta.label]) === -1
        ) {
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

  const updatePromqlKeywords = async (data: any[]) => {
    autoCompletePromqlKeywords.value = [];
    const functions = [
      "sum",
      "avg_over_time",
      "rate",
      "avg",
      "max",
      "topk",
      "histogram_quantile",
    ];
    if (!data.length) {
      functions.forEach((fun) => {
        autoCompletePromqlKeywords.value.push({
          label: fun,
          kind: "Function",
          insertText: fun,
        });
      });
      autoCompletePromqlKeywords.value.push(...metricKeywords.value);
    } else {
      autoCompletePromqlKeywords.value.push(...data);
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
      });
    });
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
