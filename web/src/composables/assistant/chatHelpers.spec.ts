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

import { raw } from "@/types/i18n";

import {
  ASSISTANT_SET_QUERY_KEY,
  HELPER_PREFIXES,
  HELPER_REQUEST_STARTS,
  decodeAssistantSet,
  encodeAssistantSet,
  starterPayload,
  type AssistantSetField,
  type HelperLanguage,
} from "./chatHelpers";
import { isHelperChat } from "./historyContext";

const NOW = 1_800_000_000_000;

describe("starterPayload", () => {
  it("stages a starter without a window as its prompt and chips only", () => {
    const chips = [{ id: "c" }] as never;
    expect(starterPayload({ prompt: "Hi", chips }, "default", NOW)).toEqual({
      text: "Hi",
      chips,
    });
  });

  it("marks a Home starter's payload, with or without a window (PO A26)", () => {
    expect(starterPayload({ prompt: "Hi", chips: [], home: true }, "default", NOW)).toEqual({
      text: "Hi",
      chips: [],
      homeStarter: true,
    });
    expect(
      starterPayload({ prompt: "Hi", chips: [], period: "1h", home: true }, "default", NOW)
        .homeStarter,
    ).toBe(true);
  });

  it("puts a door time chip ending at the click before the starter's chips", () => {
    const stream = { id: "starter-stream-k8s", kind: "stream", label: raw("k8s") } as never;
    const { text, chips } = starterPayload(
      { prompt: "Summarise errors", chips: [stream], period: "1h" },
      "default",
      NOW,
    );
    expect(text).toBe("Summarise errors");
    expect(chips).toHaveLength(2);
    expect(chips[0]).toMatchObject({
      id: "starter-time",
      kind: "time",
      provenance: "door",
      ref: { type: "time", org: "default", from: NOW - 3_600_000, to: NOW },
    });
    expect(String(chips[0].label)).toBe("last 1 h");
    expect(chips[1]).toBe(stream);
  });
});

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

describe("helper prefixes", () => {
  it("keeps every request the helper sends out of the history list, in either form", () => {
    for (const language of Object.keys(HELPER_PREFIXES) as HelperLanguage[]) {
      const prefix = HELPER_PREFIXES[language];
      expect(isHelperChat({ firstPrompt: `${prefix} : top errors` })).toBe(true);
      expect(
        isHelperChat({ title: `${prefix} : Modify this query to top errors:\n\nSELECT 1` }),
      ).toBe(true);
    }
  });

  it("lists a chat the user began with the SQL words themselves", () => {
    expect(isHelperChat({ firstPrompt: "Generate SQL query for checkout errors" })).toBe(false);
    expect(HELPER_REQUEST_STARTS).toHaveLength(4);
  });

  it("derives every request start from a helper prefix, so the two lists cannot drift", () => {
    const prefixes = new Set(Object.values(HELPER_PREFIXES));
    for (const start of HELPER_REQUEST_STARTS)
      expect(prefixes.has(start.replace(/ : $/, ""))).toBe(true);
    for (const prefix of prefixes)
      expect(HELPER_REQUEST_STARTS.some((start) => start.startsWith(prefix))).toBe(true);
  });
});
