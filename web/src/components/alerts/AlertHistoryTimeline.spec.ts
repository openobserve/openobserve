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

// Guards the firingLabel/okLabel parameterization of the shared timeline.
// Alerts keep the default "Firing"/"Ok"; workflows pass "Failed"/"Success".
// (This survived the main merge, which had migrated/de-prefixed the same file.)

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AlertHistoryTimeline from "./AlertHistoryTimeline.vue";

const history = [
  { status: "error", timestamp: 1000 },
  { status: "success", timestamp: 2000 },
  { status: "success", timestamp: 3000 },
];

describe("AlertHistoryTimeline — legend labels", () => {
  it("defaults to alert wording (Firing / Ok)", () => {
    const w = mount(AlertHistoryTimeline, { props: { history } });
    expect(w.text()).toContain("Firing");
    expect(w.text()).toContain("Ok");
  });

  it("uses provided labels for workflows (Failed / Success)", () => {
    const w = mount(AlertHistoryTimeline, {
      props: { history, firingLabel: "Failed", okLabel: "Success" },
    });
    const text = w.text();
    expect(text).toContain("Failed");
    expect(text).toContain("Success");
    expect(text).not.toContain("Firing");
  });
});
