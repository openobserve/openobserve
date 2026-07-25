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

// NOTE: this fixture used `error` as its firing representative, which only
// worked while the timeline lumped errors in with firings. `error` is a
// first-class backend outcome (`RunOutcome::Error`) meaning the evaluation
// itself failed — the alert did NOT trigger — so it now has its own bucket.
const history = [
  { status: "firing", timestamp: 1000 },
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

describe("AlertHistoryTimeline — error bucket", () => {
  const withError = [
    { status: "firing", timestamp: 1000 },
    { status: "error", timestamp: 2000 },
    { status: "normal", timestamp: 3000 },
  ];

  // An errored evaluation is neither a firing nor healthy. Before it had its
  // own bucket it fell into the catch-all and was displayed as "Skipped".
  it("counts errors separately from firing, ok and skipped", () => {
    const text = mount(AlertHistoryTimeline, { props: { history: withError } }).text();
    expect(text).toContain("1 Firing");
    expect(text).toContain("1 Ok");
    expect(text).toContain("1 Error");
    expect(text).not.toContain("Skipped");
  });

  it("does not count an error as a firing", () => {
    const onlyError = [{ status: "error", timestamp: 1000 }];
    const text = mount(AlertHistoryTimeline, { props: { history: onlyError } }).text();
    expect(text).toContain("1 Error");
    expect(text).not.toContain("Firing");
  });

  it("allows the error label to be overridden alongside firing/ok", () => {
    const text = mount(AlertHistoryTimeline, {
      props: { history: withError, firingLabel: "Failed", okLabel: "Success", errorLabel: "Broken" },
    }).text();
    expect(text).toContain("1 Broken");
    expect(text).not.toContain("Error");
  });
});
