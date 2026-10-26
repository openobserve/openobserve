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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import FleetVersionBars from "./FleetVersionBars.vue";

const mountBars = (
  versions: { version: string; count: number }[],
  outdatedVersions: string[] = [],
  target = "0.124.0",
) =>
  mount(FleetVersionBars, {
    props: { versions, target, outdatedVersions },
    global: { plugins: [i18n] },
  });

const variantOf = (w: ReturnType<typeof mountBars>, version: string) =>
  w
    .find(`[data-test="fleet-version-bars-row-${version}"]`)
    .findComponent({ name: "OProgressBar" })
    .props("variant");

describe("FleetVersionBars", () => {
  it("colours a version outdated exactly when the server flagged its collectors", () => {
    const w = mountBars(
      [
        { version: "0.124.0", count: 3 },
        { version: "0.123.9", count: 1 },
        { version: "0.99.1", count: 1 },
      ],
      ["0.123.9"],
    );
    expect(variantOf(w, "0.124.0")).toBe("success");
    expect(variantOf(w, "0.123.9")).toBe("warning");
    expect(variantOf(w, "0.99.1")).toBe("success");
  });

  it("orders versions numerically, newest first", () => {
    const w = mountBars([
      { version: "0.99.1", count: 1 },
      { version: "0.124.0", count: 1 },
    ]);
    const rows = w
      .findAll('[data-test^="fleet-version-bars-row-"]')
      .map((r) => r.attributes("data-test"));
    expect(rows).toEqual(["fleet-version-bars-row-0.124.0", "fleet-version-bars-row-0.99.1"]);
  });

  it("shows the empty state when no versions are reported", () => {
    expect(mountBars([]).find('[data-test="fleet-version-bars-empty"]').exists()).toBe(true);
  });

  it("captions the bars with the target version, which an admin may set below the latest", () => {
    expect(mountBars([{ version: "0.162.0", count: 1 }], [], "0.170.0").text()).toContain(
      "Target version: 0.170.0",
    );
  });
});
