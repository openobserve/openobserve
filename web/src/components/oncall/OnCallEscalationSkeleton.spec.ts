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

import OnCallEscalationSkeleton from "@/components/oncall/OnCallEscalationSkeleton.vue";
import i18n from "@/locales";

const stubs = {
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
};

function render() {
  return mount(OnCallEscalationSkeleton, { global: { plugins: [i18n], stubs } });
}

describe("OnCallEscalationSkeleton", () => {
  /// The card that swaps in once `/escalation` resolves carries this same
  /// heading — a mismatch here is what let the placeholder go one card taller
  /// or shorter than the real thing and reintroduce the jump this fixes.
  it("carries the real card's own status role and heading", () => {
    const wrapper = render();

    const root = wrapper.find('[data-test="oncall-escalation-skeleton"]');
    expect(root.attributes("role")).toBe("status");
    expect(root.attributes("aria-live")).toBe("polite");
    expect(wrapper.text()).toContain("Escalation");
  });

  it("reserves a few timeline-row-shaped placeholders", () => {
    const wrapper = render();

    expect(wrapper.findAll(".animate-pulse, .skeleton-wave").length).toBeGreaterThan(0);
  });
});
