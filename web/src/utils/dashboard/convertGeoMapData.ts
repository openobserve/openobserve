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
      return queryField;
    }
  );

  const options: any = {
    lmap: {
      // See https://leafletjs.com/reference.html#map-option for details
      // NOTE: note that this order is reversed from Leaflet's [lat, lng]!
      center: [
        panelSchema.config.map_view.lng,
        panelSchema.config.map_view.lat,
      ], // [lng, lat]
      zoom: panelSchema.config.map_view.zoom,
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

  options.series = panelSchema.queries.map((query: any, index: any) => {
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

  return { options };
};
