// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
stage as "stage",
funnel_type as "type",
value as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Funnel Mutiple

// Example Query:
// SELECT
// stage as "stage",
// funnel_type as "type",
// value as "value"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const stageAlias = "stage";
const typeAlias = "type";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, stageKey, typeKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const funnelMap = new Map();

  chartData.forEach(row => {
    const type = row[typeKey] || 'default';
    if (!funnelMap.has(type)) {
      funnelMap.set(type, []);
    }
    funnelMap.get(type).push({
      name: row[stageKey],
      value: row[valueKey] || 0
    });
  });

  return Array.from(funnelMap.entries()).map(([type, data], idx) => ({
    name: type,
    type: 'funnel',
    left: \`\${idx * 30 + 10}%\`,
    width: '25%',
    height: '80%',
    top: '10%',
    data: data
  }));
};

const series = processData(data[0], stageAlias, typeAlias, valueAlias);

option = {
  tooltip: {
    trigger: 'item',
    formatter: '{a} <br/>{b} : {c}%'
  },
  legend: {
    data: series.map(s => s.name)
  },
  series: series
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
