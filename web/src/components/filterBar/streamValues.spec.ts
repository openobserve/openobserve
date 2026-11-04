// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/composables/fieldValueStore", () => ({
  requestFieldValues: vi.fn(async () => ["cart", "checkout"]),
  requestFieldValuesMatching: vi.fn(async () => ["cart"]),
}));

import { requestFieldValues, requestFieldValuesMatching } from "@/composables/fieldValueStore";
import { streamValuesLoader } from "./streamValues";

describe("streamValuesLoader", () => {
  it("reads the stream's top values through the logs bar's values API while nothing is typed", async () => {
    const load = streamValuesLoader({ org: "default", streamType: "logs", streamName: "app_logs" });
    expect(await load!("service", "")).toEqual(["cart", "checkout"]);
    expect(requestFieldValues).toHaveBeenCalledWith(
      { org: "default", streamType: "logs", streamName: "app_logs" },
      "service",
    );
    expect(requestFieldValuesMatching).not.toHaveBeenCalled();
  });

  it("searches typed text through the matching lane, so keystrokes supersede and reuse answers", async () => {
    vi.mocked(requestFieldValues).mockClear();
    const load = streamValuesLoader({ org: "default", streamType: "logs", streamName: "app_logs" });
    expect(await load!("service", "ca")).toEqual(["cart"]);
    expect(requestFieldValuesMatching).toHaveBeenCalledWith(
      { org: "default", streamType: "logs", streamName: "app_logs" },
      "service",
      "ca",
    );
    expect(requestFieldValues).not.toHaveBeenCalled();
  });

  it("offers no loader while the stream is unknown or still a variable, so typing stays free", () => {
    expect(streamValuesLoader(null)).toBeUndefined();
    expect(
      streamValuesLoader({ org: "default", streamType: "logs", streamName: "" }),
    ).toBeUndefined();
    expect(
      streamValuesLoader({ org: "default", streamType: "logs", streamName: "$stream" }),
    ).toBeUndefined();
  });
});
