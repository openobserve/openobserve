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

const DEFAULT_SYMBOL_SIZE = 5;
// ECharts draws scatter points at 0.8 when no opacity is set.
const DEFAULT_SYMBOL_OPACITY = 0.8;
export const SYMBOL_SIZE_MAX = 100;

/** The panel config keys that style PromQL/SQL series; an object, so a bare number cannot pass as it. */
export interface SeriesStyleConfig {
  line_thickness?: number | null;
  symbol_size?: number | string | null;
  symbol_opacity?: number | string | null;
}

/** True when the point size is unset or a positive number up to SYMBOL_SIZE_MAX. */
export const isScatterSymbolSizeValid = (size: unknown): boolean =>
  size == null ||
  size === "" ||
  (typeof size === "number" && Number.isFinite(size) && size > 0 && size <= SYMBOL_SIZE_MAX);

/** Scatter point size in px from `config.symbol_size`; unset or invalid keeps 5. */
export const getScatterSymbolSize = (config?: SeriesStyleConfig | null): number => {
  const size = config?.symbol_size;
  return typeof size === "number" && isScatterSymbolSizeValid(size) ? size : DEFAULT_SYMBOL_SIZE;
};

/** Scatter point opacity (0-1) from the 0-100 `config.symbol_opacity`; undefined keeps the chart default. */
export const getScatterSymbolOpacity = (config?: SeriesStyleConfig | null): number | undefined => {
  const opacity = config?.symbol_opacity;
  return typeof opacity === "number" && Number.isFinite(opacity)
    ? Math.min(100, Math.max(0, opacity)) / 100
    : undefined;
};

/** The opacity a scatter point is drawn at, set or default. */
export const getScatterBaseOpacity = (config?: SeriesStyleConfig | null): number =>
  getScatterSymbolOpacity(config) ?? DEFAULT_SYMBOL_OPACITY;
