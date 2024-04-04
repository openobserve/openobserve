export const parsePromQlQuery = (query: string) => {
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

export const addLabelToPromQlQuery = (
  originalQuery: any,
  label: any,
  value: any,
  operator: any
) => {

  const conditionToAdd = value ? `${label}${operator}"${value}"` : `${label}`;

  try {
    const parsedQuery = parsePromQlQuery(originalQuery);

    let query = "";
    if (!parsedQuery.label.hasLabels) {
      query = originalQuery + `{${conditionToAdd}}`;
    } else {
      query =
        originalQuery.slice(0, parsedQuery.label.position.end) +
        (originalQuery[parsedQuery.label.position.end - 1] !== "," &&
        parsedQuery.label.position.end - parsedQuery.label.position.start > 1
          ? ","
          : "") +
        conditionToAdd +
        originalQuery.slice(
          parsedQuery.label.position.end,
          originalQuery.length
        );
    }
    return query;
  } catch (e) {
    return originalQuery;
  }
};
