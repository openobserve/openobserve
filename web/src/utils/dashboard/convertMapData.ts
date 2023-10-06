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
  console.log("panelSchema", panelSchema);

  console.log("mapData", mapData);

  //if no latitude and longitude than return it 
  if (
    !panelSchema.queries[0]?.fields?.latitude ||
    !panelSchema.queries[0]?.fields?.longitude ||
    !mapData
  ) {
    return { options: null };
  }

  // validate if response is not at number
  const nonNumericValues = panelSchema.queries.forEach(
    (query: any, index: any) => {
      const queryResult = mapData[index];

      const queryField = queryResult?.forEach((item: any) => {
        if (isNaN(item[query.fields.latitude.alias])) {
          throw new Error("All latitude values should be numeric value.");
        }
        if (isNaN(item[query.fields.longitude.alias])) {
          throw new Error("All longitude values should be numeric value.");
        }
        if (query.fields.weight && isNaN(item[query.fields.weight.alias])) {
          throw new Error("All weight values should be numeric value.");
        }
      });
      console.log("queryField", queryField);
      return queryField;
    }
  );

  console.log(nonNumericValues, "nonNumericValues");

  const options: any = {
    lmap: {
      // See https://leafletjs.com/reference.html#map-option for details
      // NOTE: note that this order is reversed from Leaflet's [lat, lng]!
      center: [panelSchema.config.mapview.lon, panelSchema.config.mapview.lat], // [lng, lat]
      zoom: panelSchema.config.mapview.zoom,
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
      textStyle: {
        fontSize: 10,
      },
      padding: 6,
      backgroundColor: "rgba(255,255,255,0.8)",
    },
    visualMap: {
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
    },
    toolbox: {
      show: true,
      left: "left",
      top: "top",
    },
    legend: {
      show: true,
      type: "scroll",
      orient: "vertical",
      left: "left",
      top: "bottom",
      padding: [10, 20, 10, 10],
      tooltip: {
        show: true,
        padding: 10,
        textStyle: {
          fontSize: 12,
        },
        backgroundColor: "rgba(255,255,255,0.8)",
      },
      textStyle: {
        width: 100,
        overflow: "truncate",
      },
    },
    series: [],
  };

  console.log("Number of queries in panelSchema:", panelSchema.queries.length);
  options.series = panelSchema.queries.map((query: any, index: any) => {
    console.log("query", query);
    console.log("query.config.weight_fixed", query.config.weight_fixed);

    return {
      name: `Layer ${index + 1}`,
      type: query.config.layer_type,
      coordinateSystem: "lmap",
      emphasis: {
        label: {
          show: true,
        },
      },
      data: mapData[index]?.map((item: any) => {
        if (query.customQuery) {
          console.log("item[query.fields.longitude.alias]", item[query.fields.longitude]);
          console.log("item[query.fields.latitude.alias]", item[query.fields.latitude]);
          
          // For custom queries
          return [
            item[query.fields.longitude.alias],
            item[query.fields.latitude.alias],
            item[query.fields.weight.alias] == null
              ? query.config.weight_fixed
              : item[query.fields.weight.alias],
          ];
        } else {
          // For auto queries
          return [
            item.longitude,
            item.latitude,
            item.weight == null ? query.config.weight_fixed : item.weight,
          ];
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
  console.log("panelSchema.queries.fields.latitude.alias", panelSchema.queries[0]?.fields?.latitude?.alias);
  console.log("panelSchema.queries.fields.longitude.alias", panelSchema.queries[0]?.fields?.longitude?.alias);


  const seriesData = options.series.flatMap((series: any) => series.data);
   if (seriesData.length > 0) {
     const minValue = Math.min(...seriesData.map((item: any) => item[2]));
     const maxValue = Math.max(...seriesData.map((item: any) => item[2]));

     options.visualMap.min = minValue;
     options.visualMap.max = maxValue;
   } else {
     options.visualMap = [];
     options.series = [];
   }
  console.log("options convertMapData", options);

  return { options };
};
