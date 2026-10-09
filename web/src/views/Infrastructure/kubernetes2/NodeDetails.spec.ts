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
import i18n from "@/locales";
import OTag from "@/lib/core/Badge/OTag.vue";
import NodeDetails from "./NodeDetails.vue";
import RelatedPodsTable from "./RelatedPodsTable.vue";
import { buildInventory, type Inventory, type Series } from "./kubernetesModel";
import type { QueryId } from "./kubernetesQueries";
import { joinObjects, parseObjects } from "./kubernetesObjects";

const GI = 1024 ** 3;

const ksm = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster: "prod", ...metric },
  value,
});
const results = (entries: Partial<Record<QueryId, Series[]>>) =>
  new Map(Object.entries(entries) as [QueryId, Series[]][]);

const pod = (name: string, node: string) => ({
  namespace: "shop",
  pod: name,
  uid: `${name}-u`,
  node,
});

const build = (observed: boolean): Inventory => {
  const inventory = buildInventory(
    results({
      N1: [
        ksm({ node: "n1", condition: "Ready", status: "true" }),
        ksm({ node: "n1", condition: "MemoryPressure", status: "false" }),
        ksm({ node: "n1", condition: "DiskPressure", status: "true" }),
      ],
      N2: [
        ksm({ node: "n1", resource: "cpu" }, 4),
        ksm({ node: "n1", resource: "memory" }, 16 * GI),
        ksm({ node: "n1", resource: "pods" }, 110),
      ],
      N3: [
        ksm({
          node: "n1",
          internal_ip: "10.0.0.7",
          os_image: "Bottlerocket OS 1.20",
          kernel_version: "6.1.90",
          container_runtime_version: "containerd://1.7.11",
          kubelet_version: "v1.30.2",
        }),
      ],
      N4: [ksm({ node: "n1", key: "dedicated", value: "gpu", effect: "NoSchedule" })],
      P1: [
        ksm({ ...pod("web-1", "n1"), phase: "Running" }),
        ksm({ ...pod("web-2", "n1"), phase: "Running" }),
        ksm({ ...pod("web-3", "n2"), phase: "Running" }),
      ],
      P6: [ksm(pod("web-1", "n1")), ksm(pod("web-2", "n1")), ksm(pod("web-3", "n2"))],
    }),
  );
  if (observed) {
    joinObjects(
      inventory,
      "node",
      "prod",
      parseObjects([
        {
          uid: "node-uid",
          event_name: "n1",
          body_type: "MODIFIED",
          body_object_metadata: JSON.stringify({ uid: "node-uid" }),
          body_object_spec: JSON.stringify({ unschedulable: true }),
          body_object_status: JSON.stringify({
            addresses: [
              { type: "InternalIP", address: "10.0.0.7" },
              { type: "Hostname", address: "ip-10-0-0-7.ec2.internal" },
            ],
            nodeInfo: { operatingSystem: "linux", architecture: "arm64" },
            capacity: { cpu: "4", memory: "16Gi", pods: "110" },
          }),
        },
      ]),
    );
  }
  return inventory;
};

const mountNode = (observed: boolean) => {
  const inventory = build(observed);
  return mount(NodeDetails, {
    props: { row: inventory.nodes[0], inventory, end: 0 },
    global: { plugins: [i18n], stubs: { RelatedPodsTable: true } },
  });
};

const text = (wrapper: ReturnType<typeof mountNode>, id: string) =>
  wrapper.find(`[data-test="k8s2-node-${id}"] dd`).text();

describe("NodeDetails", () => {
  it("reads addresses, OS image, kernel, runtime and kubelet from N3", () => {
    const wrapper = mountNode(false);
    expect(text(wrapper, "addresses")).toContain("InternalIP: 10.0.0.7");
    expect(text(wrapper, "os-image")).toContain("Bottlerocket OS 1.20");
    expect(text(wrapper, "kernel")).toContain("6.1.90");
    expect(text(wrapper, "runtime")).toContain("containerd://1.7.11");
    expect(text(wrapper, "kubelet")).toContain("v1.30.2");
    expect(text(wrapper, "os")).toBe("—");
  });

  it("adds hostname, OS and SchedulingDisabled from the object", () => {
    const wrapper = mountNode(true);
    expect(text(wrapper, "addresses")).toContain("Hostname: ip-10-0-0-7.ec2.internal");
    expect(text(wrapper, "os")).toContain("linux (arm64)");
    expect(text(wrapper, "conditions")).toContain("SchedulingDisabled");
  });

  it("shows taints as badges", () => {
    expect(text(mountNode(false), "taints")).toContain("dedicated=gpu:NoSchedule");
  });

  it("shows the true conditions as filled badges by tone", () => {
    const tags = mountNode(false)
      .find('[data-test="k8s2-node-conditions"]')
      .findAllComponents(OTag)
      .map((tag) => [tag.text(), tag.props("variant")]);
    expect(tags).toEqual([
      ["Ready", "success"],
      ["DiskPressure", "warning"],
    ]);
  });

  it("shows allocatable from N2 and capacity only from the object", () => {
    const plain = mountNode(false);
    expect(text(plain, "allocatable")).toContain("cpu: 4.00");
    expect(text(plain, "allocatable")).toContain("pods: 110");
    expect(text(plain, "capacity")).toBe("—");
    expect(text(mountNode(true), "capacity")).toContain("memory: 16Gi");
  });

  it("lists exactly this node's pods, with bars against allocatable", () => {
    const table = mountNode(false).findComponent(RelatedPodsTable);
    expect((table.props("pods") as any[]).map((p) => p.name).sort()).toEqual(["web-1", "web-2"]);
    expect(table.props("allocatable")).toMatchObject({ cpu: 4, memory: 16 * GI });
  });
});
