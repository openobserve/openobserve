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
import FleetFlowEdge from "./FleetFlowEdge.vue";

describe("FleetFlowEdge", () => {
  it("opens the edge from a label click, through the edge's own click target", async () => {
    const wrapper = mount(FleetFlowEdge, {
      props: {
        id: "a->d",
        sourceX: 100,
        sourceY: 50,
        targetX: 300,
        targetY: 80,
        sourcePosition: "right" as any,
        targetPosition: "left" as any,
        data: { severity: "error", sourceLabel: raw("v1"), targetLabel: raw("2 items/s") },
      },
      attachTo: document.body,
      global: { stubs: { EdgeLabelRenderer: { template: "<div><slot /></div>" } } },
    });
    const clicks: { x: number; y: number }[] = [];
    wrapper
      .find('[data-test="fleet-flow-edge-a->d-hit"]')
      .element.addEventListener("click", (e) =>
        clicks.push({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }),
      );
    await wrapper
      .find('[data-test="fleet-flow-edge-a->d-source-label"]')
      .trigger("click", { clientX: 40, clientY: 12 });
    await wrapper
      .find('[data-test="fleet-flow-edge-a->d-target-label"]')
      .trigger("click", { clientX: 90, clientY: 30 });
    expect(clicks).toEqual([
      { x: 40, y: 12 },
      { x: 90, y: 30 },
    ]);
    wrapper.unmount();
  });

  it("caps each label at its half of the edge less the offset, truncating it and keeping the full text as its title", () => {
    const label = raw("v12 reverted automatically");
    const wrapper = mount(FleetFlowEdge, {
      props: {
        id: "a->d",
        sourceX: 100,
        sourceY: 50,
        targetX: 300,
        targetY: 80,
        sourcePosition: "right" as any,
        targetPosition: "left" as any,
        data: { severity: "error", sourceLabel: label, targetLabel: raw("No throughput data") },
      },
      global: { stubs: { EdgeLabelRenderer: { template: "<div><slot /></div>" } } },
    });
    const el = wrapper.find('[data-test="fleet-flow-edge-a->d-source-label"]');
    const target = wrapper.find('[data-test="fleet-flow-edge-a->d-target-label"]');
    for (const [node, text] of [
      [el, label],
      [target, "No throughput data"],
    ] as const) {
      expect(node.classes()).toEqual(
        expect.arrayContaining([
          "truncate",
          "max-w-[calc(var(--fleet-edge-half)-0.75rem)]",
          "pointer-events-auto",
          "z-10",
        ]),
      );
      expect(node.attributes("style")).toContain("--fleet-edge-half: 100px");
      expect(node.attributes("title")).toBe(text);
    }
  });
});
