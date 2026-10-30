// Copyright 2026 OpenObserve Inc.
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

import { color as echartsColor } from "echarts/core";
import { chartColor } from "@/utils/chartTheme";

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of any CSS colour, or null when it cannot be parsed. */
export const colorLuminance = (color: unknown): number | null => {
  if (typeof color !== "string" || !color) return null;
  const rgba = echartsColor.parse(color);
  if (!rgba) return null;
  return 0.2126 * channel(rgba[0]) + 0.7152 * channel(rgba[1]) + 0.0722 * channel(rgba[2]);
};

/** White or black, whichever contrasts more with `background`; the same in both themes, since a tile keeps its colour. */
export const labelColorOn = (background: unknown): string => {
  const luminance = colorLuminance(background);
  if (luminance === null) return chartColor("--color-text-inverse");
  const onWhite = 1.05 / (luminance + 0.05);
  const onBlack = (luminance + 0.05) / 0.05;
  return onWhite >= onBlack ? chartColor("--color-white") : chartColor("--color-black");
};

/** The colour ECharts paints a tile under a `colorSaturation` range, which in fact sets HSL lightness. */
export const withLightness = (color: string, lightness: number): string =>
  echartsColor.modifyHSL(color, undefined, undefined, lightness) || color;
