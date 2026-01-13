// Copyright 2025 OpenObserve Inc.
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
 * Utility functions for determining variable scope types
 */

/**
 * Determines the scope type of a variable based on its configuration
 * @param variable - The variable object to check
 * @returns "panels" | "tabs" | "global"
 */
export const getScopeType = (variable: any): "panels" | "tabs" | "global" => {
  if (variable.panels && variable.panels.length > 0) {
    return "panels";
  } else if (variable.tabs && variable.tabs.length > 0) {
    return "tabs";
  } else {
    return "global";
  }
};
