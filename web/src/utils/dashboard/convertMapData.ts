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
export const convertMapData = (mapData: any) => {
    console.log("panelSchema", mapData);
    const mapDataaa = mapData.map((item: any) => ({
      name: item.x_axis_1,
      value: item.y_axis_1,
    }));
    console.log("mapDataaa", mapDataaa);
    
    const minValue = Math.min(...mapDataaa.map((item: any) => item.value));
    const maxValue = Math.max(...mapDataaa.map((item: any) => item.value));

    const options: any = {
      lmap: {
        // See https://leafletjs.com/reference.html#map-option for details
        // NOTE: note that this order is reversed from Leaflet's [lat, lng]!
        center: [10, 60], // [lng, lat]
        zoom: 4,
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
        min: 1000,
        max: 520000,
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
        // {
        //   name: "USA PopEstimates",
        //   type: "scatter",
        //   coordinateSystem: "lmap",
        //   emphasis: {
        //     label: {
        //       show: true,
        //     },
        //   },
        //   // data: mapDataaa,
        //   data: [
        //     [120, 30, 28],
        //     [120.1, 20, 3],
        //     [115.5, 28, 7],
        //     [121, 32, 6],
        //     [119.7, 25, 4],
        //     [118.8, 22, 25],
        //     [119.3, 27, 9],
        //     [120.5, 31, 2],
        //     [121.2, 33, 7],
        //     [119.9, 29, 6],
        //     [120.7, 26, 23],
        //     [118.3, 24, 8],
        //     [121.5, 30, 5],
        //     [119.6, 21, 4],
        //     [119.8, 23, 9],
        //     [120.3, 28, 2],
        //     [120.9, 27, 21],
        //     [118.7, 22, 27],
        //     [121.3, 31, 35],
        //     [119.4, 25, 6],
        //   ],
        //   symbolSize: function (val: any) {
        //     return val[2];
        //   },
        //   itemStyle: {
        //     color: "#b02a02",
        //   },
        //   encode: {
        //     // encode the third element of data item as the `value` dimension
        //     value: 2,
        //   },
        // },
        {
          name: "USA PopEstimates",
          type: "map",
          map: "USA",
          coordinateSystem: "leaflet",
          emphasis: {
            label: {
              show: true,
            },
          },

          // data: mapDataaa,
          data: [
            { name: "Alabama", value: 1000 },
            { name: "Alaska", value: 20000 },
            { name: "Arizona", value: 3000 },
            { name: "Arkansas", value: 40000 },
            { name: "California", value: 5000 },
            { name: "Colorado", value: 60000 },
            { name: "Connecticut", value: 7000 },
            { name: "Delaware", value: 80000 },
            { name: "District of Columbia", value: 9000 },
            { name: "Florida", value: 100000 },
            { name: "Georgia", value: 11000 },
            { name: "Hawaii", value: 120000 },
            { name: "Idaho", value: 13000 },
            { name: "Illinois", value: 140000 },
            { name: "Indiana", value: 15000 },
            { name: "Iowa", value: 160000 },
            { name: "Kansas", value: 17000 },
            { name: "Kentucky", value: 180000 },
            { name: "Louisiana", value: 19000 },
            { name: "Maine", value: 200000 },
            { name: "Maryland", value: 21000 },
            { name: "Massachusetts", value: 220000 },
            { name: "Michigan", value: 23000 },
            { name: "Minnesota", value: 240000 },
            { name: "Mississippi", value: 25000 },
            { name: "Missouri", value: 260000 },
            { name: "Montana", value: 27000 },
            { name: "Nebraska", value: 280000 },
            { name: "Nevada", value: 29000 },
            { name: "New Hampshire", value: 300000 },
            { name: "New Jersey", value: 31000 },
            { name: "New Mexico", value: 320000 },
            { name: "New York", value: 33000 },
            { name: "North Carolina", value: 340000 },
            { name: "North Dakota", value: 35000 },
            { name: "Ohio", value: 360000 },
            { name: "Oklahoma", value: 37000 },
            { name: "Oregon", value: 380000 },
            { name: "Pennsylvania", value: 39000 },
            { name: "Rhode Island", value: 400000 },
            { name: "South Carolina", value: 41000 },
            { name: "South Dakota", value: 420000 },
            { name: "Tennessee", value: 43000 },
            { name: "Texas", value: 440000 },
            { name: "Utah", value: 45000 },
            { name: "Vermont", value: 460000 },
            { name: "Virginia", value: 47000 },
            { name: "Washington", value: 480000 },
            { name: "West Virginia", value: 49000 },
            { name: "Wisconsin", value: 500000 },
            { name: "Wyoming", value: 51000 },
            { name: "Puerto Rico", value: 520000 },
          ],

          // symbolSize: function (val: any) {
          //   return val[2];
          // },
          // itemStyle: {
          //   color: "#b02a02",
          // },
          // encode: {
          //   // encode the third element of data item as the `value` dimension
          //   value: 2,
          // },
        },
      ],
    };
    console.log(
      "options",
      options.series
    );
    return {  options };
}

