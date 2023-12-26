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
  // const mapData = [
  //   // { name: "Alabama", value: 4822023 },
  //   // { name: "Alaska", value: 731449 },
  //   // { name: "Arizona", value: 6553255 },
  //   // { name: "Arkansas", value: 2949131 },
  //   // { name: "California", value: 38041430 },
  //   // { name: "Colorado", value: 5187582 },
  //   // { name: "Connecticut", value: 3590347 },
  //   // { name: "Delaware", value: 917092 },
  //   // { name: "District of Columbia", value: 632323 },
  //   // { name: "Florida", value: 19317568 },
  //   // { name: "Georgia", value: 9919945 },
  //   // { name: "Hawaii", value: 1392313 },
  //   // { name: "Idaho", value: 1595728 },
  //   // { name: "Illinois", value: 12875255 },
  //   ["India", 6537334 ],
  //   // { name: "Iowa", value: 3074186 },
  //   // { name: "Kansas", value: 2885905 },
  //   // { name: "Kentucky", value: 4380415 },
  //   // { name: "Louisiana", value: 4601893 },
  //   // { name: "Maine", value: 1329192 },
  //   // { name: "Maryland", value: 5884563 },
  //   ["Russia",6646144 ],
  //   // { name: "Michigan", value: 9883360 },
  //   // { name: "Minnesota", value: 5379139 },
  //   // { name: "Mississippi", value: 2984926 },
  //   // { name: "Missouri", value: 6021988 },
  //   [ "United States",  1005141 ],
  //   // { name: "Nebraska", value: 1855525 },
  //   // { name: "Nevada", value: 2758931 },
  //   // { name: "New Hampshire", value: 1320718 },
  //   // { name: "New Jersey", value: 8864590 },
  //   // { name: "New Mexico", value: 2085538 },
  //   // { name: "New York", value: 19570261 },
  //   // { name: "North Carolina", value: 9752073 },
  //   // { name: "North Dakota", value: 699628 },
  //   // { name: "Ohio", value: 11544225 },
  //   // { name: "Oklahoma", value: 3814820 },
  //   // { name: "Oregon", value: 3899353 },
  //   // { name: "Pennsylvania", value: 12763536 },
  //   // { name: "Rhode Island", value: 1050292 },
  //   // { name: "South Carolina", value: 4723723 },
  //   // { name: "South Dakota", value: 833354 },
  //   // { name: "Tennessee", value: 6456243 },
  //   // { name: "Texas", value: 26059203 },
  //   // { name: "Utah", value: 2855287 },
  //   // { name: "Vermont", value: 626011 },
  //   // { name: "Virginia", value: 8185867 },
  //   // { name: "Washington", value: 6897012 },
  //   // { name: "West Virginia", value: 1855413 },
  //   // { name: "Wisconsin", value: 5726398 },
  //   // { name: "Wyoming", value: 576412 },
  //   // { name: "Puerto Rico", value: 3667084 },
  // ];
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
          return [
            item[query.fields.name.alias],
            item[query.fields.value.alias],
          ];
        } else {
          console.log("item", item);
          
          // For auto queries
          return [item.name, item.value];
        }
      }),
      // data: mapData,
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
  console.log("seriesData", seriesData);
  
  if (seriesData.length > 0) {
    const minValue = Math.min(...seriesData.map((item: any) => item[1]));
    const maxValue = Math.max(...seriesData.map((item: any) => item[1]));
console.log("minValue", minValue, "maxValue", maxValue);

    options.visualMap.min = minValue;
    options.visualMap.max = maxValue;
  } else {
    options.visualMap = [];
    options.series = [];
  }

  return { options };
};
