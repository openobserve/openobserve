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

import { onOverviewFocusRequest } from "@/composables/goto/goToRequests";

import { isHomeAskShown } from "./fullThreadRoute";

describe("isHomeAskShown", () => {
  it("is true only on Home's briefing while an Ask box listens, whatever ?tab= says", () => {
    const home = { name: "home", query: {} };
    expect(isHomeAskShown(home)).toBe(false);
    const stop = onOverviewFocusRequest(() => undefined);
    try {
      expect(isHomeAskShown(home)).toBe(true);
      expect(isHomeAskShown({ name: "home", query: { tab: "ai" } })).toBe(true);
      expect(isHomeAskShown({ name: "home", query: { tab: "ai", thread: "s1" } })).toBe(false);
      expect(isHomeAskShown({ name: "logs", query: {} })).toBe(false);
      expect(isHomeAskShown(null)).toBe(false);
    } finally {
      stop();
    }
    expect(isHomeAskShown(home)).toBe(false);
  });
});
