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

const shadeColor = (color: any, value: any, min: any, max: any) => {
  let percent: any = scaleValue(value, min, max);
  let R: any = parseInt(color.substring(1, 3), 16);
  let G: any = parseInt(color.substring(3, 5), 16);
  let B: any = parseInt(color.substring(5, 7), 16);

  R = parseInt(((R * (100 + percent)) / 100).toString());
  G = parseInt(((G * (100 + percent)) / 100).toString());
  B = parseInt(((B * (100 + percent)) / 100).toString());

  R = R < 255 ? R : 255;
  G = G < 255 ? G : 255;
  B = B < 255 ? B : 255;

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
      return nameToColor(value, colorArrayBySeries);
    }
  }
};
