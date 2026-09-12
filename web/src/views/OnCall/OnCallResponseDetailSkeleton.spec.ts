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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallResponseDetailSkeleton from "@/views/OnCall/OnCallResponseDetailSkeleton.vue";
import i18n from "@/locales";

const stubs = {
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
};

function render() {
  return mount(OnCallResponseDetailSkeleton, { global: { plugins: [i18n], stubs } });
}

describe("OnCallResponseDetailSkeleton", () => {
  /// This stands in for the WHOLE page while `response` is still null — the
  /// gap that previously rendered nothing at all under the (already-visible)
  /// page header. A missing root/role here is the bug coming back.
  it("renders a labelled status region", () => {
    const wrapper = render();

    const root = wrapper.find('[data-test="oncall-response-detail-skeleton"]');
    expect(root.exists()).toBe(true);
    expect(root.attributes("role")).toBe("status");
    expect(root.attributes("aria-live")).toBe("polite");
  });

  /// Four tiles, matching the real page's stat strip (time-to-ack, open-for,
  /// reached-rung, firing) — fewer than four would make the strip narrower
  /// while loading than once the real one renders.
  it("reserves four stat tiles", () => {
    const wrapper = render();

    expect(wrapper.findAll(".basis-52").length).toBe(4);
  });

  /// One card on the left (Activity), three on the right (On-call details,
  /// Escalation, Routing details) — the real page's `lg:col-span-2` split.
  it("reserves four cards across the two-column body", () => {
    const wrapper = render();

    expect(wrapper.findAllComponents({ name: "OCard" }).length).toBe(4);
  });
});
