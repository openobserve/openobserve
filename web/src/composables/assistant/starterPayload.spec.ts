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

import { starterPayload } from "./starterPayload";

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
