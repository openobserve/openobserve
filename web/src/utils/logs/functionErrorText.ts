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

const asText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value) return String(value.message);
  return String(value);
};

/** Query-function messages as plain text: the server's list, or its JSON text, reads one message per line. */
export const functionErrorText = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(asText).join("\n");
  if (typeof value !== "string") return value ? asText(value) : "";
  if (!/^\s*[[{"]/.test(value)) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(asText).join("\n");
    if (typeof parsed === "string" || (parsed && typeof parsed === "object")) return asText(parsed);
  } catch {
    // Not JSON after all: a message that merely starts with a bracket or a quote.
  }
  return value;
};
