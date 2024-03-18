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

/**
 * Converts Map data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} mapData - the map data
 * @return {Object} - the option object for rendering the map chart
 */
export const convertGeoMapData = (panelSchema: any, mapData: any) => {
  console.log("convertGeoMapData", panelSchema, mapData);
  //if no name and value than return it
  if (
    !panelSchema.queries[0]?.fields?.name ||
    !panelSchema.queries[0]?.fields?.value ||
    !mapData
  ) {
    return { options: null };
  }
  const options: any = {};
  options.tooltip = {
    trigger: "item",
    showDelay: 0,
    transitionDuration: 0.2,
  };

  options.visualMap = {
    left: "right",
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
  };

  options.toolbox = {
    show: true,
    left: "left",
    top: "top",
  };
  options.xAxis = [];
  options.yAxis = [];
  options.series = panelSchema.queries.map((query: any, index: any) => {
    return {
      name: "USA PopEstimates",
      type: "map",
      map: "world",
      emphasis: {
        label: {
          show: true,
        },
      },
      data: mapData[index]?.map((item: any) => {
        if (query.customQuery) {
          // For custom queries
          return {
            name: item[query.fields.name.alias],
            value: item[query.fields.value.alias],
          };
        } else {
          // For auto queries
          return { name: item.name, value: item.value };
        }
      }),
      symbolSize: function (val: any) {
        return val[2];
      },
      itemStyle: {
        color: "#b02a02",
      },
      encode: {
        value: 2,
      },
    };
  });
   const seriesData = options.series.flatMap((series: any) => series.data);

   if (seriesData.length > 0) {
     const minValue = Math.min(...seriesData.map((item: any) => item.value));
     const maxValue = Math.max(...seriesData.map((item: any) => item.value));

     options.visualMap.min = minValue;
     options.visualMap.max = maxValue;
   } else {
     options.visualMap = [];
     options.series = [];
   }

  return { options };
};
