// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
country as "country",
year as "year",
life_expectancy as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Graph Life Expectancy

// Example Query:
// SELECT
// country as "country",
// year as "year",
// life_expectancy as "value"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const countryAlias = "country";
const yearAlias = "year";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, countryKey, yearKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { nodes: [], links: [] };
  }

  const nodes = [];
  const links = [];
  const yearMap = new Map();

  chartData.forEach(row => {
    const country = row[countryKey];
    const year = row[yearKey];
    const value = row[valueKey] || 0;

    nodes.push({
      name: \`\${country}-\${year}\`,
      symbolSize: value / 5,
      value: value,
      category: country
    });

    if (!yearMap.has(country)) {
      yearMap.set(country, []);
    }
    yearMap.get(country).push({ year, name: \`\${country}-\${year}\` });
  });

  yearMap.forEach((years, country) => {
    years.sort((a, b) => a.year - b.year);
    for (let i = 0; i < years.length - 1; i++) {
      links.push({
        source: years[i].name,
        target: years[i + 1].name
      });
    }
  });

  return { nodes, links };
};

const { nodes, links } = processData(data[0], countryAlias, yearAlias, valueAlias);

option = {
  tooltip: {},
  legend: {
    data: []
  },
  series: [
    {
      type: 'graph',
      layout: 'none',
      data: nodes,
      links: links,
      roam: true,
      label: {
        show: false
      },
      emphasis: {
        focus: 'adjacency'
      }
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
