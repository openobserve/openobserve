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
//
// @vitest-environment jsdom
//
// The chip is Discovery's only view of queue state (rows never leave the list
// once enqueued), so each membership shape must map to exactly one chip — and
// "reviewed" has to win over "still pending elsewhere".

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

vi.mock("@/lib/core/Badge/OTag.vue", () => ({
  default: {
    name: "OTag",
    props: ["variant", "shape"],
    template: `<span class="o-tag" :data-variant="variant"><slot /></span>`,
  },
}));

vi.mock("@/lib/overlay/Tooltip/OTooltip.vue", () => ({
  default: {
    name: "OTooltip",
    props: ["content", "side"],
    template: `<span class="o-tooltip" :data-content="content" />`,
  },
}));

import EnqueueStatusChip from "./EnqueueStatusChip.vue";

function mountChip(queues: any[]) {
  return mount(EnqueueStatusChip, { props: { queues } });
}

describe("EnqueueStatusChip", () => {
  it("shows the triage state when the target is in no queue", () => {
    const wrapper = mountChip([]);

    expect(wrapper.find('[data-test="enqueue-chip-none"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("aiObservability.discovery.inQueue.none");
  });

  it("names the single queue it sits in", () => {
    const wrapper = mountChip([{ queueId: "q1", queueName: "Safety", status: "pending" }]);

    expect(wrapper.find('[data-test="enqueue-chip-single"]').text()).toContain("Safety");
  });

  it("falls back to the queue id when the name is missing", () => {
    const wrapper = mountChip([{ queueId: "q1", queueName: null, status: "pending" }]);

    expect(wrapper.find('[data-test="enqueue-chip-single"]').text()).toContain("q1");
  });

  it("counts multiple pending memberships and lists them in the tooltip", () => {
    const wrapper = mountChip([
      { queueId: "q1", queueName: "Safety", status: "pending" },
      { queueId: "q2", queueName: "Compliance", status: "pending" },
    ]);

    expect(wrapper.find('[data-test="enqueue-chip-multi"]').exists()).toBe(true);
    expect(wrapper.find(".o-tooltip").attributes("data-content")).toBe("Safety, Compliance");
  });

  it("reports reviewed even when another queue is still pending", () => {
    const wrapper = mountChip([
      { queueId: "q1", queueName: "Safety", status: "pending" },
      { queueId: "q2", queueName: "Compliance", status: "reviewed" },
    ]);

    const chip = wrapper.find('[data-test="enqueue-chip-reviewed"]');
    expect(chip.exists()).toBe(true);
    expect(chip.attributes("data-variant")).toBe("success-soft");
  });
});
