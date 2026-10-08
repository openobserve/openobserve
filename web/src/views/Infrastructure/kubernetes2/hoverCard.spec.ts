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

import { describe, expect, it } from "vitest";
import i18n from "@/locales";
import { chartColor } from "@/utils/chartTheme";
import { INVENTORY, NODES, byName, labelledInventory } from "./__fixtures__/mapInventory";
import type { NodeRow, PodRow } from "./kubernetesModel";
import { groupCard, nodeCard, podCard, tooltipStyle } from "./hoverCard";

const t = i18n.global.t as any;

const text = (html: string) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return [...div.firstElementChild!.children].map((c) => c.textContent!.trim());
};

describe("hover card (AC 87)", () => {
  it("lists a pod's name, workload, node, status and fill value, in order", () => {
    const pod = byName(labelledInventory().pods, INVENTORY) as PodRow;
    const lines = text(podCard(pod, "memLim", t, null));
    expect(lines.join(" | ")).toBe(
      [
        "inventory-service-blkdl5tcm2-94jdl",
        "commerce · Deployment/inventory-service",
        `Node: ${pod.node}`,
        "Running · Memory at 92% of its limit",
        "Memory % of limit: 92%",
      ].join(" | "),
    );
    expect(lines.join("\n")).not.toMatch(/ of .* request|app\.kubernetes\.io/);
  });

  it("adds a Restarts line when the fill is not restarts and the pod restarted", () => {
    const pod = { ...byName(labelledInventory().pods, INVENTORY), restarts: 3 } as PodRow;
    expect(text(podCard(pod, "cpuReq", t, null))).toContain("Restarts: 3");
    const restartsFill = text(podCard(pod, "restarts", t, null));
    expect(restartsFill.filter((l) => l.startsWith("Restarts"))).toEqual(["Restarts: 3"]);
    expect(text(podCard({ ...pod, restarts: 0 }, "cpuReq", t, null)).join()).not.toContain(
      "Restarts",
    );
  });

  it("names No owner and Unscheduled, and escapes every value", () => {
    const pod = {
      ...byName(labelledInventory().pods, INVENTORY),
      name: "<script>alert(1)</script>",
      workload: null,
      node: "",
    } as PodRow;
    const html = podCard(pod, "cpuReq", t, null);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    const lines = text(html);
    expect(lines[1]).toBe("commerce · No owner");
    expect(lines[2]).toBe("Node: Unscheduled");
  });

  it("shows a node's zone only when its labels were observed", () => {
    const node = labelledInventory().nodes.find((n) => n.name === NODES[0]) as NodeRow;
    const lines = text(nodeCard(node, t));
    expect(lines[0]).toBe(NODES[0]);
    expect(lines).toContain("Zone: us-east-1a");
    expect(text(nodeCard({ ...node, object: null }, t)).join()).not.toContain("Zone");
  });

  it("styles the tooltip with surface tokens and the surface radius", () => {
    const style = tooltipStyle();
    expect(style.extraCssText).toContain("var(--radius-surface)");
    expect(style.extraCssText).not.toMatch(/border-radius:\s*[\d.]+(rem|px)/);
    expect(style.backgroundColor).toBe(chartColor("--color-surface-overlay"));
    expect(style.borderColor).toBe(chartColor("--color-border-default"));
    expect(style.textStyle.color).toBe(chartColor("--color-text-body"));
    expect(style.borderWidth).toBe(1);
  });

  it("summarises a group header in words", () => {
    const lines = text(
      groupCard(
        "ip-10-0-13-37.ec2.internal",
        "12 pods",
        [
          { cls: "error", count: 3 },
          { cls: "warning", count: 1 },
          { cls: "ok", count: 8 },
        ],
        t,
      ),
    );
    expect(lines).toEqual(["ip-10-0-13-37.ec2.internal", "12 pods", "3 error, 1 warning, 8 OK"]);
  });
});
