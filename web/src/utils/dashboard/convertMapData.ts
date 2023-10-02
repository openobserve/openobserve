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
export const convertMapData = (layertype: any, mapData: any) => {
  console.log(
    "layer_type",
    layertype.queries[0].config
      .layer_type
  );

  console.log("panelSchema", mapData);
  const mapDataaa = mapData.map((item: any) => [
    item.longitude,
    item.latitude,
    item.weight || layertype.queries[0].config.weight_fixed,
  ]);
  console.log("mapDataaa", mapDataaa);

  const minValue = Math.min(...mapDataaa.map((item: any) => item[2]));
  const maxValue = Math.max(...mapDataaa.map((item: any) => item[2]));

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
      min: minValue,
      max: maxValue,
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
    series: [
      {
        name: "USA PopEstimates",
        type: layertype.queries[0].config.layer_type,
        coordinateSystem: "lmap",
        emphasis: {
          label: {
            show: true,
          },
        },
        data: mapDataaa,
        symbolSize: function (val: any) {
          return val[2];
        },
        itemStyle: {
          color: "#b02a02",
        },
        encode: {
          // encode the third element of data item as the `value` dimension
          value: 2,
        },
      },
    ],
  };
  console.log("options", options.series);
  return { options };
};

