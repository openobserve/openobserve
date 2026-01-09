// Copyright 2023 OpenObserve Inc.
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

import { getDataValue } from "./aliasUtils";
import { getCountryName } from "./countryMappings";

/**
 * Converts Map data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} mapData - the map data
 * @return {Object} - the option object for rendering the map chart
 */
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";

export const convertMapsData = (panelSchema: any, mapData: any) => {
  //if no name and value than return it
  if (
    !panelSchema.queries[0]?.fields?.name ||
    !panelSchema.queries[0]?.fields?.value_for_maps ||
    !mapData
  ) {
    return { options: null };
  }

  const options: any = {};

  options.tooltip = {
    trigger: "item",
    showDelay: 0,
    transitionDuration: 0.2,
    backgroundColor: "rgba(255,255,255,0.8)",
    formatter: function (params: any) {
      let formattedValue = params.value;
      if (formattedValue === "-" || Number.isNaN(formattedValue)) {
        formattedValue = "-";
      } else if (getUnitValue && formatUnitValue) {
        formattedValue = formatUnitValue(
          getUnitValue(
            formattedValue,
            panelSchema.config?.unit,
            panelSchema.config?.unit_custom,
            panelSchema.config?.decimals,
          ),
        );
      }

      return `${params.name}: ${formattedValue}`;
    },
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
      ] as const,
    },
    text: ["High", "Low"],
    calculable: true,
  };

  options.toolbox = {
    show: true,
    left: "left",
    top: "top",
  } as const;
  options.xAxis = [];
  options.yAxis = [];
  options.series = panelSchema.queries.map((query: any, index: any) => {
    return {
      type: "map",
      map: panelSchema.config?.map_type.type || "world",
      emphasis: {
        label: {
          show: true,
        },
      },
      data: mapData[index]?.map((item: any) => {
        const countryName = getCountryName(
          getDataValue(item, query.fields.name.alias),
        ); // Map to full country name
        const value = getDataValue(item, query.fields.value_for_maps.alias);

        if (query.customQuery) {
          // For custom queries
          return { name: countryName, value };
        } else {
          // For auto queries
          return { name: countryName, value };
        }
      }),
      itemStyle: {
        color: "#b02a02",
      },
    };
  });
  if (!options.series.map((item: any) => item.data).every(Array.isArray)) {
    return;
  }

  const seriesData = options.series.flatMap((series: any) => series.data);

  if (seriesData.length > 0) {
    const numericValues = seriesData
      .map((item: any) => item.value)
      .filter(
        (value: any): value is number =>
          typeof value === "number" && !Number.isNaN(value),
      );

    const minValue =
      numericValues.length === 1 ? 0 : Math.min(...numericValues); 
    const maxValue = Math.max(...numericValues);

    options.visualMap.min = minValue;
    options.visualMap.max = maxValue;
  } else {
    options.visualMap = [];
    options.series = [];
  }

  return { options };
};
