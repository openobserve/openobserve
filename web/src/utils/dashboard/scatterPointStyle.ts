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

/** Scatter point size in px from `config.symbol_size`; unset or invalid keeps 5. */
export const getScatterSymbolSize = (config: any): number =>
  Number.isFinite(config?.symbol_size) && config.symbol_size > 0
    ? config.symbol_size
    : DEFAULT_SYMBOL_SIZE;

/** Scatter point opacity (0-1) from the 0-100 `config.symbol_opacity`; undefined keeps the chart default. */
export const getScatterSymbolOpacity = (config: any): number | undefined =>
  Number.isFinite(config?.symbol_opacity)
    ? Math.min(100, Math.max(0, config.symbol_opacity)) / 100
    : undefined;
