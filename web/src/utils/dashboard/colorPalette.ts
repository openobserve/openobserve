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
  "#a2b6ff",
  "#889ef9",
  "#6e87df",
  "#5470c6",
  "#385aad",
  "#c3ffa5",
  "#aae58d",
  "#91cc75",
  "#79b35e",
  "#619b48",
  "#ffffa1",
  "#fffb89",
  "#ffe170",
  "#fac858",
  "#dfaf40",
  "#ffb1ac",
  "#ff9794",
  "#ff7f7d",
  "#ee6666",
  "#d24d50",
  "#c1ffff",
  "#a6f3ff",
  "#8dd9f8",
  "#73c0de",
  "#59a8c5",
  "#89eeb9",
  "#6fd4a1",
  "#56bb89",
  "#3ba272",
  "#1c8a5c",
  "#ffce98",
  "#ffb580",
  "#ff9c69",
  "#fc8452",
  "#e06c3c",
  "#e6a7ff",
  "#cc8fe6",
  "#b377cd",
  "#9a60b4",
  "#824a9c",
  "#ffc7ff",
  "#ffaeff",
  "#ff95e5",
  "#ea7ccc",
  "#d064b3",
];

export const shadeColor = (color: any, value: any, min: any, max: any) => {
  let percent = 0;
  if (max === min) {
    percent = 0;
  } else {
    percent = (value - min) / (max - min);
  }
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
            if (!Number.isNaN(val[1])) {
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
      if (
        data[key] !== undefined &&
        !Number.isNaN(data[key]) &&
        data[key] !== null
      ) {
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

  const classicColorPaletteLength = classicColorPalette.length;

  // If the seriesName is empty, return 1 as a default hash value
  if (seriesName.length === 0) return 1;

  // Loop through each character in the series name
  for (let i = 0; i < seriesName.length; i++) {
    const char = seriesName.charCodeAt(i); // Get the Unicode value of the character
    hash = (hash << 5) - hash + char; // Bitwise hash computation
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Ensure the hash is positive and between 0 to 99
  return Math.abs(hash) % classicColorPaletteLength;
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
