// Copyright 2023 Zinc Labs Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

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
          promql_legend: data.config.promql_legend || "",
        },
      },
    ],
  };
};

export function convertDashboardSchemaVersion(data: any) {
  if (!data) {
    return;
  }
  if (!data.version) data = { ...data, version: 1 };
  console.log("convertDashboardSchemaVersion", data);
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
    case 2: {
      // layout width migration from 12 col number to 48 col number
      data.panels.forEach((panelItem: any) => {
        panelItem.layout.w = panelItem.layout.w * 4;
        panelItem.layout.x = panelItem.layout.x * 4;
      });

      // convert array of panels to array of tabs
      data.tabs = [
        {
          panels: data.panels,
          name: "Default",
          tabId: "default",
        },
      ];
      // remove panels key from data
      delete data.panels;

      // update the version
      data.version = 3;
      break;
    }
    case 3: {
      data.tabs.forEach((tabItem: any) => {
        tabItem.panels.forEach((panelItem: any) => {
          panelItem.queries.forEach((queryItem: any) => {
            queryItem.type = panelItem.type;
            if (queryItem.fields.x.length > 1 && queryItem.type != "table") {
              queryItem.breakdown = queryItem.fields.x[1] ?? [];
            }
            queryItem.config.unit = panelItem.config.unit;
            queryItem.config.unit_custom = panelItem.config.unit_custom;
          });
          delete panelItem.type;
          delete panelItem.config.unit;
          delete panelItem.config.unit_custom;
        });
      });
      // update the version
      data.version = 4;
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
