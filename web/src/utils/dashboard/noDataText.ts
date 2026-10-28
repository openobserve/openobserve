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

import { processVariableContent } from "./variables/variablesUtils";

/** The panel's custom empty-state text with dashboard variables substituted; null when none is set. */
export const resolveNoDataText = (
  config: any,
  variablesData: any,
  context?: { tabId?: string; panelId?: string },
): string | null => {
  const text = config?.no_data_text;
  if (typeof text !== "string" || text.trim() === "") return null;
  const resolved = processVariableContent(text.trim(), variablesData, context).trim();
  return resolved === "" ? null : resolved;
};
