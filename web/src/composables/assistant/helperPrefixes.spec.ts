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

import { helperRequest } from "@/components/ai-assistant/helper/helperText";

import { HELPER_PREFIXES, HELPER_REQUEST_STARTS, type HelperLanguage } from "./helperPrefixes";
import { isHelperChat } from "./historyContext";

describe("helper prefixes", () => {
  it("keeps every request the helper sends out of the history list, in either form", () => {
    for (const language of Object.keys(HELPER_PREFIXES) as HelperLanguage[]) {
      expect(isHelperChat({ firstPrompt: helperRequest("top errors", language, null) })).toBe(true);
      expect(isHelperChat({ title: helperRequest("top errors", language, "SELECT 1") })).toBe(true);
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
