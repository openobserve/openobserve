export function PanelSchemaVersionConverted(data: any) {
  if(!data.version)data={...data,version:1};
  switch (data.version) {
    case 1:
      data = {
        version:2,
        id: data.id,
        type: data.type,
        config: {
          title: data.config.title,
          description: data.config.description,
          show_legends: data.config.show_legends,
          legends_position: data.config.legends_position,
          unit: data.config.unit,
          unit_custom: data.config.unit_custom,
        },
        queryType: data.queryType,
        queries: [
          {
            query: data.query,
            customQuery: data.customQuery,
            fields: data.fields,
            config: {
              promql_legend: data.config.promql_legend,
            },
          },
        ],
      };
  }

  return data;
}
// const dataV1 = {
//   version: 1,
//   id: "123",
//   type: "bar",
//   fields: {
//     stream: "",
//     stream_type: "logs",
//     x: [],
//     y: [],
//     filter: [],
//   },
//   config: {
//     title: "",
//     description: "",
//     show_legends: true,
//     legends_position: null,
//     promql_legend: "",
//     unit: null,
//     unit_custom: null,
//   },
//   queryType: "sql",
//   query: "",
//   customQuery: false,
// };

// const dataV2 = {
//   version: 2,
//   id: "456",
//   type: "bar",
//   config: {
//     title: "",
//     description: "",
//     show_legends: true,
//     legends_position: null,
//     unit: null,
//     unit_custom: null,
//   },
//   queryType: "sql",
//   queries: [
//     {
//       query: "",
//       customQuery: false,
//       fields: {
//         stream: "",
//         stream_type: "logs",
//         x: [],
//         y: [],
//         filter: [],
//       },
//       config: {
//         promql_legend: "",
//       },
//     },
//   ],
// };

