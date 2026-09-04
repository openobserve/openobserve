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

/**
 * Module-level singleton registry used by window.oo_logAllPanelsJSON().
 *
 * PanelContainer registers a callback here on mount and removes it on unmount.
 * Using a module singleton (instead of provide/inject or :ref) means the Map is
 * always the same object regardless of Vue's component lifecycle or GridStack
 * DOM manipulation.
 */
export const panelDownloadRegistry = new Map<string, () => void>();

/**
 * Registry for CSV data callbacks used by window.oo_getAllPanelsCsv().
 *
 * Each panel registers a function that returns { title, csv } (or null if no
 * data is available). The report server calls window.oo_getAllPanelsCsv() via
 * page.evaluate() and receives the combined result as a plain JS object.
 */
export type PanelCsvFn = () => { title: string; csv: string } | null;
export const panelCsvRegistry = new Map<string, PanelCsvFn>();
