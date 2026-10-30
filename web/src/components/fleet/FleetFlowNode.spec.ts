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
import { raw } from "@/types/i18n";
import FleetFlowNode from "./FleetFlowNode.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

describe("FleetFlowNode", () => {
  it("puts the full label in a tooltip, since the label truncates", () => {
    const label = raw("otlphttp/openobserve · first");
    const wrapper = mount(FleetFlowNode, {
      props: { id: "d:x", data: { label, icon: "cloud-upload" } },
      global: { stubs: { Handle: true } },
    });
    expect(wrapper.findComponent(OTooltip).props("content")).toBe(label);
  });

  it("rings a failing component in its severity colour", () => {
    const wrapper = mount(FleetFlowNode, {
      props: { id: "e:x", data: { label: raw("otlphttp"), icon: "send", ring: "error" } },
      global: { stubs: { Handle: true } },
    });
    const box = wrapper.find('[data-test="fleet-flow-node-e:x-box"]');
    expect(box.classes()).toEqual(
      expect.arrayContaining(["border-status-error-text", "ring-status-error-text/30"]),
    );
  });
});
