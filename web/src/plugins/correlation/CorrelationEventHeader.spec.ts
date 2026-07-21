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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import CorrelationEventHeader from "./CorrelationEventHeader.vue";

// Minimal O2 stubs — these specs assert structure/behaviour, not O2 internals.
const OBadgeStub = {
  name: "OBadge",
  props: ["variant", "size", "dot"],
  template: `<span :data-test="$attrs['data-test']"><slot /></span>`,
};
const OSeparatorStub = { name: "OSeparator", template: `<hr />` };
const OTooltipStub = {
  name: "OTooltip",
  props: ["content", "side", "disabled"],
  template: `<span data-test-stub="o-tooltip" :title="content"></span>`,
};
const OToggleGroupStub = {
  name: "OToggleGroup",
  props: ["modelValue", "type", "size"],
  emits: ["update:modelValue"],
  template: `<div><slot /></div>`,
};
const OToggleGroupItemStub = {
  name: "OToggleGroupItem",
  props: ["value", "size", "disabled"],
  template: `<button :data-test="$attrs['data-test']"><slot /></button>`,
};

const subjectChip = (over: Record<string, unknown> = {}) => ({
  key: "k8s-pod-name",
  label: "Pod",
  value: "pod-abc",
  kind: "subject" as const,
  active: false,
  ...over,
});

describe("CorrelationEventHeader.vue", () => {
  let wrapper: VueWrapper<any>;

  const createWrapper = (props = {}) =>
    mount(CorrelationEventHeader, {
      props: {
        subjectChips: [subjectChip()],
        activeSubject: "k8s-pod-name",
        ...props,
      },
      global: {
        stubs: {
          OBadge: OBadgeStub,
          OSeparator: OSeparatorStub,
          OTooltip: OTooltipStub,
          OToggleGroup: OToggleGroupStub,
          OToggleGroupItem: OToggleGroupItemStub,
        },
      },
    });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("selected-subject badge", () => {
    it("should render a 'label = value' badge for the active subject when it has a value", () => {
      wrapper = createWrapper();
      const badge = wrapper.find(
        '[data-test="correlation-event-header-active-subject-k8s-pod-name"]',
      );
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("Pod = pod-abc");
    });

    it("should not render the badge when the active subject has no value (incident case)", () => {
      wrapper = createWrapper({
        subjectChips: [subjectChip({ value: "" })],
        activeSubject: "k8s-pod-name",
      });
      expect(
        wrapper
          .find('[data-test="correlation-event-header-active-subject-k8s-pod-name"]')
          .exists(),
      ).toBe(false);
    });

    it("should not render the badge when no subject is active", () => {
      wrapper = createWrapper({ activeSubject: null });
      expect(
        wrapper
          .find('[data-test="correlation-event-header-active-subject-k8s-pod-name"]')
          .exists(),
      ).toBe(false);
    });

    it("should render the badge for whichever subject is active", () => {
      wrapper = createWrapper({
        subjectChips: [
          subjectChip(),
          subjectChip({ key: "k8s-node-name", label: "Node", value: "node-1" }),
        ],
        activeSubject: "k8s-node-name",
      });
      const badge = wrapper.find(
        '[data-test="correlation-event-header-active-subject-k8s-node-name"]',
      );
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("Node = node-1");
    });
  });
});
