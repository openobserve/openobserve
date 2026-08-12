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

import OnCallAttentionCard from "@/components/oncall/OnCallAttentionCard.vue";
import i18n from "@/locales";

const stubs = {
  OIcon: { name: "OIcon", template: "<span />" },
  OTag: { name: "OTag", template: "<span><slot /></span>" },
  OText: { name: "OText", template: "<span><slot /></span>" },
};

type Props = InstanceType<typeof OnCallAttentionCard>["$props"];

function render(props: Partial<Props> = {}) {
  return mount(OnCallAttentionCard, {
    props: { unacked: 0, ...props } as Props,
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallAttentionCard", () => {
  /// "Nothing is paging" is the most dangerous sentence in the product, so the
  /// calm state has to be the one that is genuinely earned.
  it("says so plainly when nothing is waiting on a person", () => {
    const wrapper = render({ unacked: 0 });
    expect(wrapper.find('[data-test="oncall-attention-clear"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-attention-unacked"]').exists()).toBe(false);
  });

  it("leads with the number of pages nobody has taken", () => {
    const wrapper = render({ unacked: 2 });
    expect(wrapper.find('[data-test="oncall-attention-unacked"]').text()).toBe("2");
  });

  it("counts down to the next rung that will fire", () => {
    const wrapper = render({
      unacked: 2,
      escalating: 1,
      nextEscalationAt: (Date.now() + 4 * 60_000) * 1000,
    });
    // Not exact: the countdown runs against the real clock.
    expect(wrapper.find('[data-test="oncall-attention-escalates"]').text()).toMatch(/[34]m/);
  });

  /// A deadline that has already passed says the ladder moved, which the row's
  /// own cell reports accurately — repeating it here would contradict it.
  it("drops the countdown once the deadline has passed", () => {
    const wrapper = render({
      unacked: 1,
      escalating: 1,
      nextEscalationAt: (Date.now() - 60_000) * 1000,
    });
    expect(wrapper.find('[data-test="oncall-attention-escalates"]').exists()).toBe(false);
  });

  it("reports how long the oldest page has gone unanswered", () => {
    const wrapper = render({
      unacked: 1,
      oldestOpenedAt: (Date.now() - 6 * 60_000) * 1000,
    });
    expect(wrapper.find('[data-test="oncall-attention-detail"]').text()).toMatch(/[56]m/);
  });

  it("says how many of them are the viewer's own", () => {
    const wrapper = render({ unacked: 3, assignedToMe: 2 });
    expect(wrapper.find('[data-test="oncall-attention-detail"]').text()).toContain(
      "2 are assigned to you",
    );
  });
});
