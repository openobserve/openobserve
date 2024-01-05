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

// const colorArray = [
//   '#0056b3', '#003e80', '#00294d', '#001326',
//   '#28a745', '#1f8e3e', '#156331', '#0e3f24', '#072717',
//   '#dc3545', '#a52a35', '#751e26', '#4e141a', '#27090d',
//   '#fd7e14', '#d46a11', '#a9560e', '#803f0a', '#551f06',
//   '#ffc107', '#d9a106', '#b28605', '#8b6a04', '#634d03',
//   '#6f42c1', '#57348f', '#412663', '#2a1940', '#160c20',
//   '#e83e8c', '#b82d66', '#8c1f49', '#631433', '#3f0a1d'
// ];

// [
//   "#99cadd",
//   "#a9bdd5",
//   "#d6a9bc",
//   "#c691a4",
//   "#b87c94",
//   "#ffcb20",
//   "#ff3b3b",
//   "#ff8d0c",
//   "#42a6ff",
//   "#ffb3ba",
//   "#ffdfba",
//   "#ffffba",
//   "#baffc9",
//   "#bae1ff",
//   "#a8e6cf",
//   "#dcedc1",
//   "#ffd3b6",
//   "#ffaaa5",
//   "#ff8b94",
//   "#ffbf00",
//   "#ffcf40",
//   "#ffdc73",
//   "#b88c8c",
//   "#ddadad",
//   "#d6c7c7",
//   "#9fb9bf",
//   "#aec8ce",
// ];

// [
//   "#E24D42", // Red
//   "#1F78C1", // Blue
//   "#BA43A9", // Purple
//   "#705DA0", // Violet
//   "#466803", // Green
//   "#508642", // Dark Green
//   "#447EBC", // Dark Blue
//   "#C15C17", // Brown
//   "#890F02", // Dark Red
//   "#757575", // Grey
//   "#70DBED", // Light Blue
//   "#6ED0E0", // Turquoise
//   "#B9D7D9", // Light Grey
//   "#D683CE", // Light Purple
//   "#E5AC0E", // Orange
//   "#AEA2E0", // Lavender
//   "#5195CE", // Bright Blue
//   "#D9BF77", // Beige
//   "#FADE2A", // Yellow
//   "#2F575E", // Dark Turquoise
//   "#99440A", // Dark Brown
//   "#58140C", // Maroon
//   "#052B51", // Navy
//   "#511749", // Dark Violet
//   "#3F2B5B", // Dark Indigo
//   "#E0F9D7", // Light Green
//   "#FCEACA", // Light Yellow
//   "#CFFAFF", // Sky Blue
//   "#F9E2D2", // Light Pink
//   "#FCE2DE", // Pink
//   "#BADFF4", // Light Bright Blue
//   "#F9D9F9", // Light Lavender
//   "#DEDAF7"  // Pale Lavender
// ]

export const colorArrayBySeries = [
  "#5470c6",
  "#91cc75",
  "#fac858",
  "#ee6666",
  "#73c0de",
  "#3ba272",
  "#fc8452",
  "#9a60b4",
  "#dc1e1e",
  "#9086e9",
  "#27e162",
  "#e08de6",
  "#de6086",
  "rgba(161,225,200,0.48)",
  "#ec8ceb",
  "#99e9f1",
  "#eec59c",
];

export const colorArrayByValue = [
  "#0ac670",
  "#08b968",
  "#08aa60",
  "#079f59",
  "#069a55",
];

export const getIndexForName = (name: any, colorArray: any) => {
  let index = 0;
  for (let i = 0; i < 15; i++) {
    const charCode = name.charCodeAt(i) || 0;
    index += charCode * (i + 1);
  }
  return index % colorArray.length;
};

const nameToColor = (name: any, colorArray: any) => {
  const index = getIndexForName(name, colorArray);
  return colorArray[index];
};

const scaleValue = (value: any, min: any, max: any) => {
  return ((value - min) * 100) / (max - min);
};

// const scaleValue = (value: any, min: any, max: any) => {
//   return ((value - min) * 50) / (max - min);
// };

// const scaleValue = (value: any, min: any, max: any) => {
//   return ((value - min) * 20) / (max - min) - 10;
// };

const shadeColor = (color: any, value: any, min: any, max: any) => {
  let percent: any = scaleValue(value, min, max);
  let R: any = parseInt(color.substring(1, 3), 16);
  let G: any = parseInt(color.substring(3, 5), 16);
  let B: any = parseInt(color.substring(5, 7), 16);

  R = parseInt(((R * (100 + percent)) / 255).toString());
  G = parseInt(((G * (100 + percent)) / 255).toString());
  B = parseInt(((B * (100 + percent)) / 255).toString());

  let RR = R.toString(16).length == 1 ? "0" + R.toString(16) : R.toString(16);
  let GG = G.toString(16).length == 1 ? "0" + G.toString(16) : G.toString(16);
  let BB = B.toString(16).length == 1 ? "0" + B.toString(16) : B.toString(16);

  return "#" + RR + GG + BB;
};

export const getColor = (
  panelSchema: any,
  value?: any,
  min?: any,
  max?: any
) => {
  // switch case based on panelSchema.color type
  switch (panelSchema?.color?.mode) {
    case "fixed": {
      return panelSchema?.color?.fixedColor ?? "#5b8ff9";
    }
    case "shades": {
      // based on selected color pass different shades of same color
      return shadeColor(
        panelSchema?.color?.fixedColor ?? "#5b8ff9",
        value ?? 50,
        min ?? 0,
        max ?? 100
      );
    }

    case "palette-classic": {
      // return color using colorArrayBySeries
      // NOTE: value will be series name
      return nameToColor(value, colorArrayBySeries);
    }

    case "continuous": {
      // based on selected color and value pass different shades of same color
      return shadeColor(
        panelSchema?.color?.fixedColor ?? "#5b8ff9",
        value ?? 50,
        min ?? 0,
        max ?? 100
      );
    }

    // case "scheme":

    // case "opacity":

    default: {
      // return color using colorArrayBySeries
      // NOTE: value will be series name
      // return nameToColor(value, colorArrayBySeries);
      return shadeColor(
        panelSchema?.color?.fixedColor ?? "#73bf5f",
        value ?? 50,
        min ?? 0,
        max ?? 100
      );
    }
  }
};
