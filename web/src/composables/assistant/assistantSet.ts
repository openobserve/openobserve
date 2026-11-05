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

/** The Traces query key naming the filters the assistant set when it opened the page. */
export const ASSISTANT_SET_QUERY_KEY = "assistant_set";

const FIELDS: readonly AssistantSetField[] = ["query", "stream", "time"];

export type AssistantSetField = "query" | "stream" | "time";

/** Comma-separated in a fixed order, duplicates dropped, so the same set always gives the same URL. */
export function encodeAssistantSet(fields: AssistantSetField[]): string {
  return FIELDS.filter((field) => fields.includes(field)).join(",");
}

/** Unknown entries are dropped; anything that is not a string gives the empty set. */
export function decodeAssistantSet(value: unknown): Set<AssistantSetField> {
  if (typeof value !== "string") return new Set();
  const parts = value.split(",").map((part) => part.trim());
  return new Set(FIELDS.filter((field) => parts.includes(field)));
}
