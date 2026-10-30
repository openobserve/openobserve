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
}));

import { requestFieldValues } from "@/composables/fieldValueStore";
import { streamValuesLoader } from "./streamValues";

describe("streamValuesLoader", () => {
  it("reads the stream's values through the logs bar's values API, passing the typed search", async () => {
    const load = streamValuesLoader({ org: "default", streamType: "logs", streamName: "app_logs" });
    expect(await load!("service", "ca")).toEqual(["cart", "checkout"]);
    expect(requestFieldValues).toHaveBeenCalledWith(
      { org: "default", streamType: "logs", streamName: "app_logs" },
      "service",
      { keyword: "ca" },
    );
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
