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
import store from "@/stores";
import PodDetails from "./PodDetails.vue";
import { buildInventory, type PodRow, type Series } from "./kubernetesModel";
import type { QueryId } from "./kubernetesQueries";
import { joinObjects, parseObjects } from "./kubernetesObjects";

const MI = 1024 ** 2;

const ksm = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster: "prod", namespace: "shop", pod: "web-1", uid: "u1", ...metric },
  value,
});
const results = (entries: Partial<Record<QueryId, Series[]>>) =>
  new Map(Object.entries(entries) as [QueryId, Series[]][]);

const podRow = (node = "n1"): PodRow =>
  buildInventory(
    results({
      P1: [ksm({ phase: "Running" })],
      P11: [ksm({ condition: "true" })],
      P6: [ksm({ node, pod_ip: "10.0.0.5", priority_class: "high" })],
      P10: [ksm({ container: "app", image: "shop/app:1.2" })],
      P13: [ksm({ container: "app" }, 1)],
      P3: [ksm({ container: "app", reason: "OOMKilled" })],
      P7: [ksm({ container: "app" }, 2)],
      P8: [
        ksm({ container: "app", resource: "cpu" }, 0.1),
        ksm({ container: "app", resource: "memory" }, 128 * MI),
      ],
      P9: [
        ksm({ container: "app", resource: "cpu" }, 0.2),
        ksm({ container: "app", resource: "memory" }, 256 * MI),
      ],
    }),
  ).pods[0];

const OBJECT = {
  metadata: { uid: "u1", name: "web-1" },
  spec: {
    serviceAccountName: "shop-sa",
    nodeSelector: { "kubernetes.io/os": "linux" },
    tolerations: [{ key: "dedicated", operator: "Equal", value: "shop", effect: "NoSchedule" }],
    initContainers: [{ name: "init-db", image: "busybox:1" }],
    containers: [
      {
        name: "app",
        image: "shop/app:1.2",
        imagePullPolicy: "Always",
        command: ["/bin/app"],
        args: ["--port", "8080"],
        ports: [{ name: "http", containerPort: 8080, protocol: "TCP" }],
        env: [
          { name: "MODE", value: "prod" },
          { name: "PASS", valueFrom: { secretKeyRef: { name: "db", key: "password" } } },
        ],
        volumeMounts: [
          { name: "data", mountPath: "/data" },
          { name: "cfg", mountPath: "/etc/cfg", readOnly: true },
        ],
        livenessProbe: {
          httpGet: { path: "/healthz", port: 8080, scheme: "HTTP" },
          timeoutSeconds: 1,
          periodSeconds: 10,
          successThreshold: 1,
          failureThreshold: 3,
        },
      },
    ],
  },
  status: {
    podIPs: [{ ip: "10.0.0.5" }, { ip: "fd00::5" }],
    qosClass: "Burstable",
    conditions: [
      { type: "Initialized", status: "True" },
      { type: "Ready", status: "True" },
      { type: "ContainersReady", status: "False", lastTransitionTime: "2026-10-01T10:00:00Z" },
      { type: "PodScheduled", status: "True" },
    ],
    initContainerStatuses: [
      { name: "init-db", ready: true, state: { terminated: { reason: "Completed" } } },
    ],
    containerStatuses: [
      {
        name: "app",
        lastState: {
          terminated: {
            reason: "OOMKilled",
            exitCode: 137,
            startedAt: "2026-10-01T09:00:00Z",
            finishedAt: "2026-10-01T09:30:00Z",
          },
        },
      },
    ],
  },
};

const observedRow = () => {
  const inventory = { ...buildInventory(new Map()), pods: [podRow()] };
  joinObjects(
    inventory,
    "pod",
    "prod",
    parseObjects([
      {
        uid: "u1",
        event_name: "web-1",
        k8s_namespace_name: "shop",
        body_type: "MODIFIED",
        body_object_metadata: JSON.stringify(OBJECT.metadata),
        body_object_spec: JSON.stringify(OBJECT.spec),
        body_object_status: JSON.stringify(OBJECT.status),
      },
    ]),
  );
  return inventory.pods[0];
};

const mountPod = (row: PodRow) =>
  mount(PodDetails, { props: { row }, global: { plugins: [i18n, store] } });

const field = (wrapper: ReturnType<typeof mountPod>, container: string, name: string) =>
  wrapper.find(`[data-test="k8s2-pod-container-${container}-${name}"]`);

describe("PodDetails containers", () => {
  it("shows the square, status, P3 reason, image, requests and limits from metrics", () => {
    const wrapper = mountPod(podRow());
    const block = wrapper.find('[data-test="k8s2-pod-container-app"]');
    expect(block.find('[data-test="k8s2-container-square-app"]').exists()).toBe(true);
    expect(field(wrapper, "app", "status").text()).toContain("running, ready");
    expect(field(wrapper, "app", "last-status").text()).toContain("OOMKilled");
    expect(field(wrapper, "app", "image").text()).toContain("shop/app:1.2");
    expect(field(wrapper, "app", "requests").text()).toContain("100m");
    expect(field(wrapper, "app", "limits").text()).toContain("200m");
    expect(field(wrapper, "app", "ports").exists()).toBe(false);
    expect(field(wrapper, "app", "pull-policy").exists()).toBe(false);
    expect(wrapper.find('[data-test="k8s2-pod-init-containers"]').exists()).toBe(false);
  });

  it("adds ports, unresolved env, mounts, Lens probes and command from the object", () => {
    const wrapper = mountPod(observedRow());
    expect(field(wrapper, "app", "ports").text()).toContain("http: 8080/TCP");
    const env = field(wrapper, "app", "env").text();
    expect(env).toContain("MODE=prod");
    expect(env).toContain("PASS=secretKeyRef db/password");
    const mounts = field(wrapper, "app", "mounts").text();
    expect(mounts).toContain("/data from data (rw)");
    expect(mounts).toContain("/etc/cfg from cfg (ro)");
    expect(field(wrapper, "app", "liveness").text()).toContain(
      "http-get http://:8080/healthz delay=0s timeout=1s period=10s #success=1 #failure=3",
    );
    expect(field(wrapper, "app", "command").text()).toContain("/bin/app");
    expect(field(wrapper, "app", "args").text()).toContain("--port 8080");
    expect(field(wrapper, "app", "pull-policy").text()).toContain("Always");
    expect(field(wrapper, "app", "last-status").text()).toContain("137");
  });

  it("lists init containers only when the object was observed", () => {
    const wrapper = mountPod(observedRow());
    const init = wrapper.find('[data-test="k8s2-pod-init-containers"]');
    expect(init.find('[data-test="k8s2-pod-container-init-db"]').exists()).toBe(true);
    expect(
      wrapper
        .find('[data-test="k8s2-pod-containers"] [data-test="k8s2-pod-container-init-db"]')
        .exists(),
    ).toBe(false);
  });
});

describe("PodDetails conditions", () => {
  const condition = (wrapper: ReturnType<typeof mountPod>, type: string) =>
    wrapper.find(`[data-test="k8s2-pod-condition-${type}"]`);

  it("without an object, shows Ready from P11 and PodScheduled from the node", () => {
    const scheduled = mountPod(podRow());
    expect(condition(scheduled, "Ready").attributes("data-active")).toBe("true");
    expect(condition(scheduled, "PodScheduled").attributes("data-active")).toBe("true");
    expect(condition(scheduled, "Initialized").exists()).toBe(false);
    const unscheduled = mountPod(podRow(""));
    expect(condition(unscheduled, "PodScheduled").attributes("data-active")).toBe("false");
  });

  it("with an object, shows all four and dims the false ones", () => {
    const wrapper = mountPod(observedRow());
    for (const type of ["Initialized", "Ready", "PodScheduled"]) {
      expect(condition(wrapper, type).attributes("data-active")).toBe("true");
    }
    const notReady = condition(wrapper, "ContainersReady");
    expect(notReady.attributes("data-active")).toBe("false");
    expect(notReady.classes()).toContain("opacity-50");
  });

  it("shows the object's QoS, service account, node selector and tolerations", () => {
    const wrapper = mountPod(observedRow());
    expect(wrapper.find('[data-test="k8s2-pod-qos"]').text()).toContain("Burstable");
    expect(wrapper.find('[data-test="k8s2-pod-qos"]').text()).not.toContain("≈");
    expect(wrapper.find('[data-test="k8s2-pod-service-account"]').text()).toContain("shop-sa");
    expect(wrapper.find('[data-test="k8s2-pod-node-selector"]').text()).toContain(
      "kubernetes.io/os=linux",
    );
    expect(wrapper.find('[data-test="k8s2-pod-tolerations"]').text()).toContain(
      "dedicated=shop:NoSchedule",
    );
    expect(wrapper.find('[data-test="k8s2-pod-ips"]').text()).toContain("fd00::5");
  });

  it("marks an estimated QoS and links the node", async () => {
    const wrapper = mountPod(podRow());
    expect(wrapper.find('[data-test="k8s2-pod-qos"]').text()).toContain("≈ Burstable");
    await wrapper.find('[data-test="k8s2-pod-node-link"]').trigger("click");
    expect(wrapper.emitted("open")).toEqual([
      [{ kind: "node", cluster: "prod", namespace: "", name: "n1" }],
    ]);
  });
});
