// Copyright 2023 Zinc Labs Inc.

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

const convertPanelSchemaVersion = (data: any) => {
  if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
    return;
  }
  // converting this to new array as z axis is added in the heatmap
  const queryFields = {
    stream_type: data.fields?.stream_type || "logs",
    stream: data.fields.stream || "",
    x: data.fields?.x || [],
    y: data.fields?.y || [],
    z: [], // this is a new field
    filter: data.fields?.filter || [],
  };

  return {
    id: data.id,
    type: data.type,
    title: data.config.title,
    description: data.config.description,
    config: {
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
        fields: queryFields,
          config: {
            promql_legend: data.config.promql_legend||"",
          },
      },
    ],
  };
}

export function convertDashboardSchemaVersion(data: any) {
  if (!data) {
    return;
  }
  if (!data.version) data = { ...data, version: 1 };
  switch (data.version) {
    case 1: {
      // Create a object with key as a panel id and value will be its layout.
      const layoutsObjBasedOnPanelId: any = {};
      data?.layouts?.forEach((layout: any) => {
        layoutsObjBasedOnPanelId[layout.panelId] = {
          x: layout.x,
          y: layout.y,
          h: layout.h,
          w: layout.w,
          i: layout.i,
          // only include above fields
        };
      });

      // add layout object in panels array and also migrate panels schema using panelschemaversionconverted function
      data.panels = data?.panels?.map((panelItem: any) => ({
        //
        ...convertPanelSchemaVersion(panelItem),
        layout: layoutsObjBasedOnPanelId[panelItem.id], // Use the layout item from the mapping
      }));

      // update the version
      data.version = 2;

      // remove layouts key from data
      delete data.layouts;
      break;
    }
  }

  // return converted data
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