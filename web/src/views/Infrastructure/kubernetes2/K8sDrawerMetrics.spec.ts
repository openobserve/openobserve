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

import { afterEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import i18n from "@/locales";
import K8sDrawerMetrics from "./K8sDrawerMetrics.vue";
import type { Amount, Inventory, PodRow } from "./kubernetesModel";

vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "PanelSchemaRenderer",
      props: ["panelSchema", "selectedTimeObj", "variablesData", "forceLoad", "searchType"],
      setup: () => () => h("div"),
    }),
  };
});

enableAutoUnmount(afterEach);

const GI = 1024 ** 3;

const pod = (bounds: {
  cpuRequest: Amount;
  cpuLimit: Amount;
  memoryRequest: Amount;
  memoryLimit: Amount;
}) =>
  ({
    kind: "pod",
    cluster: "prod",
    namespace: "shop",
    name: "web-1",
    series: {},
    ...bounds,
  }) as unknown as PodRow;

const markLines = (row: PodRow) => {
  const wrapper = mount(K8sDrawerMetrics, {
    props: {
      details: { kind: "pod", cluster: "prod", namespace: "shop", name: "web-1" },
      row,
      inventory: { pods: [row] } as unknown as Inventory,
      range: { start: 0, end: 1 },
      refreshNonce: 0,
      hasStream: () => true,
    },
    global: { plugins: [i18n] },
  });
  const byTab = (id: string) =>
    wrapper
      .findAllComponents({ name: "PanelSchemaRenderer" })
      .map((r) => r.props("panelSchema"))
      .find((s: any) => s.id === `k8s2-drawer-${id}`)
      .config.mark_line.map((m: any) => [m.name, m.value, m.label]);
  return { cpu: byTab("cpu"), memory: byTab("memory") };
};

describe("K8sDrawerMetrics request and limit lines", () => {
  it("draws one line when request equals limit, so the two labels never overprint", () => {
    const lines = markLines(
      pod({ cpuRequest: 1, cpuLimit: 1, memoryRequest: GI, memoryLimit: GI }),
    );
    expect(lines.cpu).toEqual([["Request = Limit", 1, "Request = Limit: 1.00"]]);
    expect(lines.memory).toEqual([["Request = Limit", GI, "Request = Limit: 1.00GB"]]);
  });

  it("keeps separate lines, labelled in the panel unit, when request and limit differ", () => {
    const lines = markLines(
      pod({ cpuRequest: 0.5, cpuLimit: 1, memoryRequest: GI / 2, memoryLimit: GI }),
    );
    expect(lines.cpu).toEqual([
      ["Request", 0.5, "Request: 0.50"],
      ["Limit", 1, "Limit: 1.00"],
    ]);
    expect(lines.memory).toEqual([
      ["Request", GI / 2, "Request: 512.00MB"],
      ["Limit", GI, "Limit: 1.00GB"],
    ]);
  });

  it("draws a lone limit when the request is unknown", () => {
    const lines = markLines(
      pod({ cpuRequest: null, cpuLimit: 2, memoryRequest: null, memoryLimit: null }),
    );
    expect(lines.cpu).toEqual([["Limit", 2, "Limit: 2.00"]]);
    expect(lines.memory).toEqual([]);
  });
});
