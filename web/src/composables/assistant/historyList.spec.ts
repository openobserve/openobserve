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

import { lastTurnEndOf } from "./historyList";

describe("lastTurnEndOf", () => {
  it("names how the server says the last turn ended", () => {
    expect(lastTurnEndOf("completed")).toBe("done");
    expect(lastTurnEndOf("cancelled")).toBe("stopped");
    expect(lastTurnEndOf("failed")).toBe("failed");
    expect(lastTurnEndOf("interrupted")).toBe("failed");
  });

  it("gives a running, missing or unknown status no end", () => {
    expect(lastTurnEndOf("running")).toBeNull();
    expect(lastTurnEndOf(null)).toBeNull();
    expect(lastTurnEndOf(undefined)).toBeNull();
    expect(lastTurnEndOf("constructor")).toBeNull();
  });
});
