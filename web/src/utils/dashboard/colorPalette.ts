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

import { scaleLinear } from "d3-scale";

export const classicColorPalette = [
  "#A2D2DF",
  "#1AC7A7",
  "#1CD3E1",
  "#21E6D0",
  "#789DBC",
  "#2890CC",
  "#A594F9",
  "#35C676",
  "#3689BA",
  "#3A9BE5",
  "#39DC89",
  "#41B5E4",
  "#57C2B0",
  "#59E3C8",
  "#5A8FBD",
  "#5CE09F",
  "#61B4DA",
  "#6AB762",
  "#CB80AB",
  "#7BB0A1",
  "#82A8A7",
  "#86DACE",
  "#89D1CC",
  "#89EED4",
  "#8CF2B2",
  "#8BD1E9",
  "#8BA9C1",
  "#8BBDAF",
  "#8BBBE0",
  "#8BD79C",
  "#8BE0C3",
  "#7f9fb9",
  "#7fa27f",
  "#82E0AA",
  "#85929E",
  "#877bbc",
  "#8795b2",
  "#87a0a3",
  "#87a77b",
  "#87b2a3",
  "#87bca7",
  "#9467BD",
  "#98DF8A",
  "#00FFF0",
  "#9EDAE5",
  "#80FFDB",
  "#9d9dae",
  "#9f8eaa",
  "#9fb39f",
  "#A9CCE3",
  "#A9DFBF",
  "#AEC7E8",
  "#AED6F1",
  "#AF7AC5",
  "#88FFF7",
  "#B0E57C",
  "#B3CDE3",
  "#D09CFA",
  "#BAB0AC",
  "#BB8FCE",
  "#FFD0D0",
  "#BFCFFF",
  "#C39BD3",
  "#C49C94",
  "#C5B0D5",
  "#C7C7C7",
  "#99F0CA",
  "#99DDCC",
  "#B6E6BD",
  "#FC6DDC",
  "#D7BDE2",
  "#D98880",
  "#E15759",
  "#E377C2",
  "#E59866",
  "#E5D8BD",
  "#E5B0EA",
  "#E6B0AA",
  "#FAA7C7",
  "#EB984E",
  "#EC7063",
  "#FCD892",
  "#F0B27A",
  "#C9CBFF",
  "#F1948A",
  "#F1C40F",
  "#F28E2B",
  "#F4D03F",
  "#F5CBA7",
  "#F7B6D2",
  "#F7DC6F",
  "#F8C471",
  "#FAD7A0",
  "#FF9896",
  "#FF9DA7",
  "#FFBB78",
  "#c3ac87",
  "#c49182",
  "#c49f82",
  "#cbb1a6",
];

export const shadeColor = (color: any, value: any, min: any, max: any) => {
  let percent = (value - min) / (max - min);
  let num = parseInt(color.replace("#", ""), 16),
    amt = Math.round(1.55 * percent * 100),
    R = (num >> 16) + amt,
    B = ((num >> 8) & 0x00ff) + amt,
    G = (num & 0x0000ff) + amt;

  let newColor = (
    0x1000000 +
    (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
    (B < 255 ? (B < 1 ? 0 : B) : 255) * 0x100 +
    (G < 255 ? (G < 1 ? 0 : G) : 255)
  )
    .toString(16)
    .slice(1);
  return "#" + newColor;
};

export const getMetricMinMaxValue = (searchQueryData: any) => {
  // need min and max value for color
  let min = Infinity;
  let max = -Infinity;
  searchQueryData.forEach((metric: any) => {
    if (metric.result && Array.isArray(metric.result)) {
      metric?.result?.forEach((valuesArr: any) => {
        if (valuesArr.values && Array.isArray(valuesArr.values)) {
          valuesArr.values.forEach((val: any) => {
            // val[1] should not NaN
            if (!isNaN(val[1])) {
              min = Math.min(min, val[1]);
              max = Math.max(max, val[1]);
            }
          });
        }
      });
    }
  });
  return [min, max];
};

export const getSQLMinMaxValue = (yaxiskeys: any, searchQueryData: any) => {
  // need min and max value for color
  let min = Infinity;
  let max = -Infinity;

  searchQueryData[0]?.forEach((data: any) => {
    yaxiskeys?.forEach((key: any) => {
      if (data[key] !== undefined && !isNaN(data[key]) && data[key] !== null) {
        min = Math.min(min, data[key]);
        max = Math.max(max, data[key]);
      }
    });
  });

  return [min, max];
};

// need one function which will take some series name and will return hash which will be between 1 to 1000
const getSeriesHash = (seriesName: string) => {
  // Initialize a hash variable
  let hash = 0;

  // If the seriesName is empty, return 1 as a default hash value
  if (seriesName.length === 0) return 1;

  // Loop through each character in the series name
  for (let i = 0; i < seriesName.length; i++) {
    const char = seriesName.charCodeAt(i); // Get the Unicode value of the character
    hash = (hash << 5) - hash + char; // Bitwise hash computation
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Ensure the hash is positive and between 0 to 99
  return Math.abs(hash) % 100;
};

const getSeriesValueBasedOnSeriesBy = (values: any, seriesBy: string) => {
  switch (seriesBy) {
    case "last":
      return values[values.length - 1];
    case "min":
      return values.reduce((a: any, b: any) => (a < b ? a : b), values[0]);
    case "max":
      return values.reduce((a: any, b: any) => (a > b ? a : b), values[0]);
    default:
      return values[values.length - 1];
  }
};

export const getSeriesColor = (
  colorCfg: any,
  seriesName: string,
  value: any,
  chartMin: any,
  chartMax: any,
) => {
  if (!colorCfg) {
    return classicColorPalette[getSeriesHash(seriesName)];
  } else if (colorCfg.mode === "fixed") {
    return colorCfg.fixedColor[0];
  } else if (colorCfg.mode === "shades") {
    return shadeColor(
      colorCfg.fixedColor[0],
      getSeriesValueBasedOnSeriesBy(value, "last"),
      chartMin,
      chartMax,
    );
  } else if (colorCfg.mode === "palette-classic-by-series") {
    return classicColorPalette[getSeriesHash(seriesName)];
  } else if (colorCfg.mode === "palette-classic") {
    return null;
  } else {
    const d3ColorObj = scaleLinear(
      [chartMin, chartMax / 2, chartMax],
      colorCfg?.fixedColor?.length ? colorCfg?.fixedColor : classicColorPalette,
    );
    return d3ColorObj(getSeriesValueBasedOnSeriesBy(value, colorCfg.seriesBy));
  }
};
