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

import OnCallPriorCauses from "@/components/oncall/OnCallPriorCauses.vue";
import i18n from "@/locales";
import type { CauseGroup } from "@/ts/interfaces/oncall";

const stubs = {
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OTag: { name: "OTag", props: ["variant"], template: "<span><slot /></span>" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: `<button @click="$emit('click')"><slot /></button>`,
  },
};

function render(groups: CauseGroup[], loading = false) {
  return mount(OnCallPriorCauses, {
    props: { groups, loading },
    global: { plugins: [i18n], stubs },
  });
}

const group = (over: Partial<CauseGroup> = {}): CauseGroup => ({
  cause: "config_change_or_deploy",
  count: 3,
  note: "rolled back the 14:02 deploy",
  last_response_id: "resp_0",
  ...over,
});

describe("OnCallPriorCauses", () => {
  it("shows the cause, how often, and the note", () => {
    const wrapper = render([group()]);
    const row = wrapper.find('[data-test="oncall-prior-cause-config_change_or_deploy"]');

    expect(row.text()).toContain("3×");
    expect(row.text()).toContain("Config change / deploy");
    expect(row.text()).toContain("rolled back the 14:02 deploy");
  });

  /// An org with no history is told how history gets made — an empty box it
  /// cannot act on would read as something being broken.
  it("explains itself when nothing has been recorded", () => {
    const wrapper = render([]);
    const empty = wrapper.find('[data-test="oncall-prior-causes-empty"]');

    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain("first responder");
  });

  it("links to the firing behind a cause", async () => {
    const wrapper = render([group()]);

    await wrapper
      .find('[data-test="oncall-prior-cause-open-config_change_or_deploy"]')
      .trigger("click");

    expect(wrapper.emitted("open")?.[0]).toEqual(["resp_0"]);
  });

  /// A recurring defect and a recurring maintenance window are not the same
  /// news, so they must not read the same.
  it("colours a recurring defect differently from expected maintenance", () => {
    const defect = render([group({ cause: "genuine_defect" })]);
    const expected = render([group({ cause: "expected_or_maintenance" })]);
    const noisy = render([group({ cause: "noisy_threshold" })]);

    const variant = (w: any) => w.findComponent({ name: "OTag" }).props("variant");
    expect(variant(defect)).toBe("error-soft");
    expect(variant(expected)).toBe("success-soft");
    expect(variant(noisy)).toBe("amber-soft");
  });

  it("renders a cause that has no note", () => {
    const wrapper = render([group({ note: null })]);
    expect(wrapper.find('[data-test="oncall-prior-cause-config_change_or_deploy"]').text()).toContain(
      "Config change / deploy",
    );
  });

  /// While the fetch is in flight `groups` is `[]` — indistinguishable from a
  /// subject that has genuinely never had a recorded cause. Without `loading`,
  /// every response flashed "explains itself when nothing has been recorded"
  /// for a moment before its real causes (if any) arrived.
  it("does not claim no history while the fetch is still in flight", () => {
    const wrapper = render([], true);

    expect(wrapper.find('[data-test="oncall-prior-causes-empty"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="oncall-prior-causes-loading"]').exists()).toBe(true);
  });
});
