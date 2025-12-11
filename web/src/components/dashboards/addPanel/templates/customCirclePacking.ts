// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = ``;

// Chart code template
const chartCode = `
// Custom Circle Packing

// Note: This chart uses custom rendering. Modify the processData function below.

const processData = (data) => {
  const packData = {
    name: 'root',
    children: data.map((item, i) => ({
      name: item[0] || \`Circle \${i}\`,
      value: item[1] || Math.random() * 100
    }))
  };
  
  return packData;
};

const packData = processData(queryResult);

option = {
  series: [{
    type: 'custom',
    renderItem: (params, api) => {
      const x = api.value(0);
      const y = api.value(1);
      const r = api.value(2) || 10;
      
      return {
        type: 'circle',
        shape: {cx: x, cy: y, r: r},
        style: {
          fill: api.visual('color'),
          stroke: '#fff',
          lineWidth: 2
        }
      };
    },
    data: [[50, 50, 20], [100, 100, 30], [150, 75, 15]],
    encode: {x: 0, y: 1},
    coordinateSystem: 'cartesian2d'
  }],
  xAxis: {type: 'value'},
  yAxis: {type: 'value'}
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
