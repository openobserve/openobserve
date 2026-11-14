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

import { describe, expect, it } from "vitest";

import {
  ASSISTANT_SET_QUERY_KEY,
  decodeAssistantSet,
  encodeAssistantSet,
  type AssistantSetField,
} from "./assistantSet";

describe("assistantSet", () => {
  it("names the query key", () => {
    expect(ASSISTANT_SET_QUERY_KEY).toBe("assistant_set");
  });

  it.each<AssistantSetField[]>([[], ["query"], ["stream", "time"], ["time", "query", "stream"]])(
    "round-trips %j",
    (...fields) => {
      expect(decodeAssistantSet(encodeAssistantSet(fields))).toEqual(new Set(fields));
    },
  );

  it("encodes in a fixed order without duplicates", () => {
    expect(encodeAssistantSet(["time", "query", "time"])).toBe("query,time");
  });

  it("drops unknown entries and blanks", () => {
    expect(decodeAssistantSet("query,,colour, stream ,QUERY")).toEqual(
      new Set(["query", "stream"]),
    );
  });

  it.each([undefined, null, 1, ["query"]])("decodes %j to the empty set", (value) => {
    expect(decodeAssistantSet(value)).toEqual(new Set());
  });
});
