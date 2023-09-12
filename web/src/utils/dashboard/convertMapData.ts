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

/**
 * Converts Map data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} mapData - the map data
 * @return {Object} - the option object for rendering the map chart
 */
export const convertMapData = (panelSchema: any, mapData: any) => {
  console.log("map");
  const options: any = {
    tooltip: {
      trigger: "item",
      showDelay: 0,
      transitionDuration: 0.2,
    },

    visualMap: {
      left: "right",
      min: 500000,
      max: 38000000,
      inRange: {
        color: [
          "#313695",
          "#4575b4",
          "#74add1",
          "#abd9e9",
          "#e0f3f8",
          "#ffffbf",
          "#fee090",
          "#fdae61",
          "#f46d43",
          "#d73027",
          "#a50026",
        ],
      },
      text: ["High", "Low"],
      calculable: true,
    },
    toolbox: {
      show: true,
      left: "left",
      top: "top",
    },
    xAxis: [],
    yAxis: [],
    series: [
      {
        name: "USA PopEstimates",
        type: "map",
        map: "USA",
        emphasis: {
          label: {
            show: true,
          },
        },
        data: mapData,
      },
    ],
  };

  return options;
};


