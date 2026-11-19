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
import { guessDestination } from "./useDestinationGuess";

const row = (
  alert_id: string,
  destinations: string[],
  stream_name = "nginx",
  stream_type = "logs",
) => ({
  alert_id,
  stream_type,
  stream_name,
  destinations,
});

describe("guessDestination", () => {
  it.each([
    ["no alert on the stream", [row("2a", ["ops"], "other")], null],
    ["one alert", [row("2a", ["ops"])], { name: "ops", alertCount: 1 }],
    [
      "the most used wins, other streams ignored",
      [
        row("2a", ["ops", "web"]),
        row("2b", ["web"]),
        row("2c", ["ops"], "nginx", "traces"),
        row("2d", ["ops"], "api"),
      ],
      { name: "web", alertCount: 2 },
    ],
    [
      "a tie goes to the newest alert's destination",
      [row("2c", ["old"]), row("2f", ["new"]), row("2a", ["old", "new"])],
      { name: "new", alertCount: 2 },
    ],
  ])("%s", (_case, alerts, expected) => {
    expect(guessDestination(alerts, "logs", "nginx")).toEqual(expected);
  });
});
