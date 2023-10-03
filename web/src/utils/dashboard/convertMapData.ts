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
  console.log(
    "layer_type",
    panelSchema
  );

  console.log("panelSchema", mapData);

  // const minValue = Math.min(...mapData.map((item: any) => item[2]));
  // const maxValue = Math.max(...mapData.map((item: any) => item[2]));

  const options: any = {
    lmap: {
      // See https://leafletjs.com/reference.html#map-option for details
      // NOTE: note that this order is reversed from Leaflet's [lat, lng]!
      center: [10, 60], // [lng, lat]
      zoom: 14,
      roam: true,
      resizeEnable: true, // automatically handles browser window resize.
      // whether echarts layer should be rendered when the map is moving. Default is true.
      // if false, it will only be re-rendered after the map `moveend`.
      // It's better to set this option to false if data is large.
      renderOnMoving: true,
      echartsLayerInteractive: true, // Default: true
      largeMode: false, // Default: false
      // Note: Please DO NOT use the initial option `layers` to add Satellite/RoadNet/Other layers now.
    },
    tooltip: {
      trigger: "item",
      showDelay: 0,
      transitionDuration: 0.2,
    },
    visualMap: {
      left: "right",
      min: 0,
      max: 0,
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
    //   xAxis: [],
    //   yAxis: [],
    series: [],
  };

  console.log("Number of queries in panelSchema:", panelSchema.queries.length);
  panelSchema.queries.forEach((query: any, index: any) => {
    console.log("query", query);
    console.log("mapData[index]", mapData[index]);

    const seriesConfig: any = {
      name: `Query ${index + 1}`,
      type: query.config.layer_type,
      coordinateSystem: "lmap",
      emphasis: {
        label: {
          show: true,
        },
      },
      data: mapData.map((item: any) => [
        item.longitude,
        item.latitude,
        item.weight !== null ? item.weight : query.config.weight_fixed,
      ]),
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

    options.series.push(seriesConfig);
  });

  const seriesData = options.series.flatMap((series: any) => series.data);
  const minValue = Math.min(...seriesData.map((item: any) => item[2]));
  const maxValue = Math.max(...seriesData.map((item: any) => item[2]));

  options.visualMap.min = minValue;
  options.visualMap.max = maxValue;

  console.log("options", options);

  return { options };
};

