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
import type { FleetFlowEdgeData } from "./flowTypes";

const mountEdge = (data: FleetFlowEdgeData) =>
  mount(FleetFlowEdge, {
    props: {
      id: "e1",
      sourceX: 100,
      sourceY: 50,
      targetX: 300,
      targetY: 80,
      sourcePosition: "right" as any,
      targetPosition: "left" as any,
      data,
    },
    attachTo: document.body,
    global: { stubs: { EdgeLabelRenderer: { template: "<div><slot /></div>" } } },
  });

const line = (w: ReturnType<typeof mountEdge>) => w.find('[data-test="fleet-flow-edge-e1"]');

describe("FleetFlowEdge", () => {
  it("colours a line by its signal and sizes it by the given width", () => {
    const wrapper = mountEdge({ signal: "traces", width: 6 });
    expect(line(wrapper).classes()).toContain("stroke-signal-traces");
    expect(line(wrapper).attributes("stroke-width")).toBe("6");
    expect(line(wrapper).attributes("stroke-dasharray")).toBeUndefined();
    wrapper.unmount();
  });

  it("draws a failure branch dashed in the danger colour, never in the signal colour", () => {
    const wrapper = mountEdge({
      signal: "logs",
      width: 3,
      branch: true,
      label: raw("Send failed 18%"),
    });
    expect(line(wrapper).classes()).toContain("stroke-status-error-text");
    expect(line(wrapper).classes()).not.toContain("stroke-signal-logs");
    expect(line(wrapper).attributes("stroke-dasharray")).toBe("6 4");
    expect(wrapper.find('[data-test="fleet-flow-edge-e1-label"]').text()).toBe("Send failed 18%");
    wrapper.unmount();
  });

  it("thickens a highlighted line and fades a dimmed or unmeasured one", () => {
    let wrapper = mountEdge({ signal: "logs", width: 2, highlighted: true });
    expect(line(wrapper).attributes("stroke-width")).toBe("3.5");
    wrapper.unmount();
    wrapper = mountEdge({ signal: "logs", width: 2, dimmed: true });
    expect(line(wrapper).classes()).toContain("opacity-15");
    wrapper.unmount();
    wrapper = mountEdge({ signal: "logs", width: 1.5, noData: true });
    expect(line(wrapper).classes()).toContain("opacity-40");
    wrapper.unmount();
  });

  it("opens the edge from a label click, through the edge's own click target", async () => {
    const wrapper = mountEdge({ signal: "logs", width: 2, branch: true, label: raw("Dropped 2%") });
    const clicks: { x: number; y: number }[] = [];
    wrapper
      .find('[data-test="fleet-flow-edge-e1-hit"]')
      .element.addEventListener("click", (e) =>
        clicks.push({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }),
      );
    await wrapper
      .find('[data-test="fleet-flow-edge-e1-label"]')
      .trigger("click", { clientX: 40, clientY: 12 });
    expect(clicks).toEqual([{ x: 40, y: 12 }]);
    wrapper.unmount();
  });
});
