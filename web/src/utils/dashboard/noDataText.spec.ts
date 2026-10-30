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
import { resolveNoDataText } from "./noDataText";

const variables = {
  values: [
    { name: "site_meter", value: "pm-07", type: "custom" },
    { name: "region", value: ["eu", "us"], type: "query_values" },
  ],
};

describe("resolveNoDataText", () => {
  it("is null when the panel sets no text", () => {
    for (const no_data_text of [undefined, null, "", "   "]) {
      expect(resolveNoDataText({ no_data_text }, variables)).toBeNull();
    }
    expect(resolveNoDataText(undefined, variables)).toBeNull();
  });

  it("returns the text, trimmed", () => {
    expect(resolveNoDataText({ no_data_text: "  Needs setup  " }, null)).toBe("Needs setup");
  });

  it("substitutes dashboard variables in every placeholder form", () => {
    expect(
      resolveNoDataText({ no_data_text: "Set site_meter: candidates for $site_meter" }, variables),
    ).toBe("Set site_meter: candidates for pm-07");
    expect(resolveNoDataText({ no_data_text: "Meter ${site_meter} in ${region}" }, variables)).toBe(
      "Meter pm-07 in eu,us",
    );
  });

  it("keeps an unknown placeholder as typed", () => {
    expect(resolveNoDataText({ no_data_text: "Pick $unknown" }, variables)).toBe("Pick $unknown");
  });

  it("does not interpret markup; it stays text for the renderer to escape", () => {
    expect(resolveNoDataText({ no_data_text: "<b>$site_meter</b>" }, variables)).toBe(
      "<b>pm-07</b>",
    );
  });
});
