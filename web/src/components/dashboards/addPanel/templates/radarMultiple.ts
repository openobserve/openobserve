export const radarMultiple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Multiple Radar Chart - Compare multiple entities across dimensions
//
// Example Query:
// SELECT
//   dimension as "dimension_field",
//   sum(entity1_value) as "entity_1",
//   sum(entity2_value) as "entity_2"
// FROM "default"
// GROUP BY dimension_field

// 'dimensionAlias' should match the column name for dimensions
const dimensionAlias = "dimension_field";

// 'entityAliases' should be an array of column names for each entity
const entityAliases = ["entity_1", "entity_2"];

// Arrow function to process radar data
const processData = (chartData, dimKey, entityKeys) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { indicators: [], seriesData: [] };
  }

  const indicators = [];
  const seriesData = entityKeys.map(() => []);

  chartData.forEach(row => {
    const dimension = row[dimKey];

    if (dimension !== undefined) {
      // Find max value for this dimension across all entities
      const maxValue = Math.max(...entityKeys.map(key => row[key] || 0));

      indicators.push({
        name: dimension,
        max: maxValue * 1.2 // Add 20% padding
      });

      entityKeys.forEach((key, index) => {
        seriesData[index].push(row[key] || 0);
      });
    }
  });

  return { indicators, seriesData };
};

// Execute the function
const { indicators, seriesData } = processData(data[0], dimensionAlias, entityAliases);

// Generate series data
const series = entityAliases.map((alias, index) => ({
  name: alias,
  value: seriesData[index]
}));

option = {
  legend: {
    data: entityAliases
  },
  radar: {
    indicator: indicators
  },
  series: [
    {
      type: 'radar',
      data: series
    }
  ]
};
`;
