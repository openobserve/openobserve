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
 * Module-level singleton registry used by the console helpers:
 *   window.oo_downloadAllPanelsCSV()
 *   window.oo_downloadAllPanelsJSON()
 *
 * PanelContainer registers callbacks here on mount and removes them on unmount.
 * Using a module singleton (instead of provide/inject or :ref) means the Map is
 * always the same object regardless of Vue's component lifecycle or GridStack
 * DOM manipulation.
 */
export interface PanelDownloadEntry {
  csv: () => void;
  json: () => void;
}

export const panelDownloadRegistry = new Map<string, PanelDownloadEntry>();
