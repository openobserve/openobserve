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
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import i18n from "@/locales";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import RelatedPodsTable from "./RelatedPodsTable.vue";
import { buildInventory, type Series } from "./kubernetesModel";
import type { QueryId } from "./kubernetesQueries";

const ksm = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster: "prod", namespace: "shop", uid: `${metric.pod}-uid`, ...metric },
  value,
});
const kub = (pod: string, value: number): Series => ({
  metric: { k8s_cluster_name: "prod", k8s_namespace_name: "shop", k8s_pod_name: pod },
  value,
});
const results = (entries: Partial<Record<QueryId, Series[]>>) =>
  new Map(Object.entries(entries) as [QueryId, Series[]][]);

// Renders every cell through the table's own slots, so the spec reads what a user sees.
const OTableStub = defineComponent({
  name: "OTable",
  props: {
    data: Array,
    columns: Array,
    maxHeight: String,
    virtualScroll: Boolean,
    dense: Boolean,
  },
  setup(props, { slots }) {
    return () =>
      h(
        "div",
        { "data-test": "table" },
        (props.data as any[]).map((row) =>
          h(
            "div",
            { "data-test": "row", "data-name": row.name },
            (props.columns as any[]).map((col) =>
              h(
                "span",
                { "data-col": col.id },
                slots[`cell-${col.id}`]?.({ row }) ?? String(col.accessorFn?.(row) ?? ""),
              ),
            ),
          ),
        ),
      );
  },
});

const inventory = buildInventory(
  results({
    P1: ["web-1", "web-2", "web-3"].map((pod) => ksm({ pod, phase: "Running" })),
    P6: ["web-1", "web-2", "web-3"].map((pod) => ksm({ pod, node: "n1" })),
    P10: [
      ksm({ pod: "web-1", container: "a", image: "img:a" }),
      ksm({ pod: "web-1", container: "b", image: "img:b" }),
      ksm({ pod: "web-2", container: "a", image: "img:a" }),
      ksm({ pod: "web-3", container: "a", image: "img:a" }),
    ],
    P2: [ksm({ pod: "web-1", container: "b", reason: "CrashLoopBackOff" })],
    P14: [ksm({ pod: "web-2", container: "a", reason: "Error" })],
    K1: [kub("web-1", 0.5), kub("web-2", 1.5), kub("web-3", 0.1)],
    K2: [kub("web-1", 1024 ** 3), kub("web-2", 2 * 1024 ** 3), kub("web-3", 1024 ** 2)],
  }),
);

const mountTable = (props: Record<string, unknown> = {}) =>
  mount(RelatedPodsTable, {
    props: { pods: inventory.pods, end: 0, ...props },
    global: { plugins: [i18n], stubs: { OTable: OTableStub } },
  });

const cell = (wrapper: ReturnType<typeof mountTable>, pod: string, col: string) =>
  wrapper.find(`[data-name="${pod}"] [data-col="${col}"]`);

describe("RelatedPodsTable", () => {
  it("counts running containers over containers, so a waiting or terminated one is not running", () => {
    const wrapper = mountTable();
    expect(cell(wrapper, "web-1", "ready").text()).toBe("1/2");
    expect(cell(wrapper, "web-2", "ready").text()).toBe("0/1");
    expect(cell(wrapper, "web-3", "ready").text()).toBe("1/1");
  });

  it("sorts by CPU descending by default", () => {
    const wrapper = mountTable();
    expect(wrapper.findAll('[data-test="row"]').map((r) => r.attributes("data-name"))).toEqual([
      "web-2",
      "web-1",
      "web-3",
    ]);
  });

  it("is a dense, virtualized table capped at 41.25rem", () => {
    const table = mountTable().findComponent(OTableStub);
    expect(table.props("maxHeight")).toBe("41.25rem");
    expect(table.props("virtualScroll")).toBe(true);
    expect(table.props("dense")).toBe(true);
    expect((table.props("columns") as any[]).map((c) => c.id)).toEqual([
      "name",
      "warn",
      "node",
      "namespace",
      "ready",
      "cpu",
      "memory",
      "status",
    ]);
  });

  it("shows CPU and memory as text without allocatable, and as bars against it", () => {
    const plain = mountTable();
    expect(cell(plain, "web-2", "cpu").text()).toBe("1.50");
    expect(plain.findAllComponents(OProgressBar)).toHaveLength(0);
    const bars = mountTable({ allocatable: { cpu: 2, memory: 4 * 1024 ** 3 } });
    const cpuBar = cell(bars, "web-2", "cpu").findComponent(OProgressBar);
    expect(cpuBar.props("value")).toBeCloseTo(0.75);
    expect(cell(bars, "web-1", "memory").findComponent(OProgressBar).props("value")).toBeCloseTo(
      0.25,
    );
  });

  it("colours the status text by tone and links name and node", async () => {
    const wrapper = mountTable();
    expect(cell(wrapper, "web-1", "status").find("span").classes()).toContain(
      "text-status-error-text",
    );
    await cell(wrapper, "web-1", "node").find("button").trigger("click");
    await cell(wrapper, "web-1", "name").find("button").trigger("click");
    expect(wrapper.emitted("open")).toEqual([
      [{ kind: "node", cluster: "prod", namespace: "", name: "n1" }],
      [{ kind: "pod", cluster: "prod", namespace: "shop", name: "web-1" }],
    ]);
  });

  it("shows the warning icon only for pods with warnings", () => {
    const wrapper = mountTable();
    expect(cell(wrapper, "web-1", "warn").find('[data-test="k8s2-related-warn"]').exists()).toBe(
      true,
    );
    expect(cell(wrapper, "web-3", "warn").find('[data-test="k8s2-related-warn"]').exists()).toBe(
      false,
    );
  });
});
