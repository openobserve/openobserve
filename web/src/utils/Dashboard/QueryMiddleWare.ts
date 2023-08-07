export const QueryMiddleWare = {
  transformSchema,
}
function transformSchema(data: any, version: any) {
  if (version === 1) {
    const { id, type, fields, config, queryType, query, customQuery } = data;
    return {
      id,
      type,
      fields,
      config,
      queryType,
      query,
      customQuery,
    };
  } else if (version === 2) {
    const { id, type, config, queries } = data;
    const { queryType, query, customQuery, fields, promql_legend } = queries[0];
    return {
      id,
      type,
      config,
      fields,
      queryType,
      query,
      customQuery,
      promql_legend,
    };
  } else if (version === 3) {
    const { id, type, config, queries } = data;
    const { queryType, query, customQuery, fields, promql_legend } = queries[0];
    return {
      id,
      type,
      config,
      fields,
      queryType,
      query,
      customQuery,
      promql_legend,
    };
  } else {
    return data;
  }
}

const dataV1 = {
  id: "123",
  type: "bar",
  fields: {
    stream: "",
    stream_type: "logs",
    x: [],
    y: [],
    filter: [],
  },
  config: {
    title: "",
    description: "",
    show_legends: true,
    legends_position: null,
    promql_legend: "",
    unit: null,
    unit_custom: null,
  },
  queryType: "sql",
  query: "",
  customQuery: false,
};

const dataV2 = {
  id: "456",
  type: "bar",
  config: {
    title: "",
    description: "",
    show_legends: true,
    legends_position: null,
    unit: null,
    unit_custom: null,
  },
  queryType: "sql",
  queries: [
    {
      query: "",
      customQuery: false,
      fields: {
        stream: "",
        stream_type: "logs",
        x: [],
        y: [],
        filter: [],
      },
      config: {
        promql_legend: "",
      },
    },
  ],
};

const version1 = 1;
const version2 = 2;

const transformedDataV1 = transformSchema(dataV1, version1);
const transformedDataV2 = transformSchema(dataV2, version2);

console.log("transformedDataV1", transformedDataV1);
console.log("transformedDataV2", transformedDataV2);
