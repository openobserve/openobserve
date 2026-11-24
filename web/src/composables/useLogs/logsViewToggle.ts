//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

const URL_VIEW_TOGGLES = ["logs", "visualize", "build", "drilldown"];

/** The view tab a link asks for, or "logs" when the value is unknown or Patterns is locked or the stream is not logs. */
export const resolveUrlViewToggle = (
  value: unknown,
  patternsAllowed: boolean,
  streamType?: unknown,
): string => {
  if (typeof value !== "string") return "logs";
  if (value === "patterns") {
    return patternsAllowed && (!streamType || streamType === "logs") ? "patterns" : "logs";
  }
  return URL_VIEW_TOGGLES.includes(value) ? value : "logs";
};
