// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { CompareResponse, NotServingPod } from "@/services/service_versions";
import Pods from "./VersionNotServingPods.vue";
import { formatSpan } from "./VersionSummaryTiles.format";
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  dispatch: vi.fn(),
  toast: vi.fn(),
  streams: [] as string[],
  fields: [] as string[],
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("vuex", () => ({ useStore: () => ({ dispatch: mocks.dispatch }) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: async () => ({ list: mocks.streams.map((name) => ({ name })) }),
    getStream: async () => ({ schema: mocks.fields.map((name) => ({ name })) }),
  }),
}));
vi.mock("@/types/i18n", async (original) => ({
  ...(await original<object>()),
  useI18nTyped: () => ({
    t: (key: string, params?: object) => (params ? `${key} ${JSON.stringify(params)}` : key),
  }),
}));
const pod = (name: string, since: number): NotServingPod => ({
  k8s_cluster: "c1",
  k8s_namespace: "otel-demo",
  k8s_pod: name,
  k8s_workload: "checkout",
  k8s_container: "checkout",
  since,
});
const result = {
  service: "checkout",
  where_key: "k8s:c1/otel-demo",
  arms: {
    a: { version: "2.5.0", start_time: 5_000_000, end_time: 9_000_000 },
    b: { version: "2.4.1", start_time: 1, end_time: 2 },
  },
} as unknown as CompareResponse;
function render(pods: NotServingPod[], total?: number) {
  return mount(Pods, {
    props: { org: "org", result, pods, total },
    global: {
      stubs: {
        OButton: {
          emits: ["click"],
          template: "<button @click=\"$emit('click')\"><slot/></button>",
        },
      },
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.streams = ["default", "k8s_events"];
  mocks.fields = ["k8s_pod_name", "k8s_namespace_name", "k8s_cluster", "body_object_regarding"];
});
it("lists each pod with the not-serving version and a Pod logs action", () => {
  const wrapper = render([pod("checkout-x2k4p", 4_000_000), pod("checkout-m8q1z", 4_500_000)]);
  expect(wrapper.text()).toContain('serviceVersions.compare.pods.title {"where":"c1 · otel-demo"}');
  expect(wrapper.find('[data-test="svcver-pod-c1/otel-demo/checkout-x2k4p"]').text()).toBe(
    "checkout-x2k4p",
  );
  expect(wrapper.findAll('[data-test^="svcver-evidence-podLogs-"]')).toHaveLength(2);
  expect(wrapper.text()).toContain("2.5.0");
  expect(wrapper.find('[data-test="svcver-pods-more"]').exists()).toBe(false);
});
it("shows +N more when pods_total exceeds the capped list", () => {
  const wrapper = render([pod("a", 1)], 51);
  expect(wrapper.find('[data-test="svcver-pods-more"]').text()).toContain('{"count":50}');
});
it("opens the pod's logs from its own start through the arm end", async () => {
  const wrapper = render([pod("checkout-x2k4p", 4_000_000)]);
  await wrapper
    .find('[data-test="svcver-evidence-podLogs-c1/otel-demo/checkout-x2k4p"]')
    .trigger("click");
  await flushPromises();
  const route = mocks.push.mock.calls[0][0];
  expect(route.path).toBe("/logs");
  expect(route.query).toMatchObject({ stream: "default", from: 4_000_000, to: 9_000_000 });
  expect(mocks.dispatch).toHaveBeenCalledWith("logs/setIsInitialized", false);
});
it("opens Pod events on k8s_events and warns when no stream qualifies", async () => {
  const wrapper = render([pod("a", 6_000_000)]);
  await wrapper.find('[data-test="svcver-evidence-podEvents-pods"]').trigger("click");
  await flushPromises();
  expect(mocks.push.mock.calls[0][0].query).toMatchObject({
    stream: "k8s_events",
    from: 5_000_000,
  });
  mocks.streams = [];
  await wrapper.find('[data-test="svcver-evidence-podEvents-pods"]').trigger("click");
  await flushPromises();
  await wrapper.find('[data-test="svcver-evidence-podLogs-c1/otel-demo/a"]').trigger("click");
  await flushPromises();
  expect(mocks.toast.mock.calls.map(([call]) => call.message)).toEqual([
    "serviceVersions.compare.pods.eventsNoStream",
    "serviceVersions.compare.pods.logsNoStream",
  ]);
  expect(mocks.push).toHaveBeenCalledTimes(1);
});
it("shows each pod status and readiness, a dash when absent, and zero requests", () => {
  const wrapper = render([
    { ...pod("crash", 1), status: "CrashLoopBackOff", ready: false },
    { ...pod("up", 2), status: "running", ready: true },
    pod("otel-only", 3),
  ]);
  const cell = (kind: string, name: string) =>
    wrapper.find(`[data-test="svcver-pod-${kind}-c1/otel-demo/${name}"]`);
  expect(cell("status", "crash").text()).toBe("CrashLoopBackOff");
  expect(cell("ready", "crash").text()).toBe("serviceVersions.compare.pods.ready.no");
  expect(cell("ready", "crash").classes()).toContain("text-error-600");
  expect(cell("status", "up").text()).toBe("serviceVersions.compare.pods.status.running");
  expect(cell("ready", "up").text()).toBe("serviceVersions.compare.pods.ready.yes");
  expect(cell("ready", "up").classes()).not.toContain("text-error-600");
  expect(cell("status", "otel-only").text()).toBe("—");
  expect(cell("ready", "otel-only").text()).toBe("—");
  expect(["crash", "up", "otel-only"].map((name) => cell("requests", name).text())).toEqual([
    "0",
    "0",
    "0",
  ]);
  expect(wrapper.text()).toContain("serviceVersions.compare.pods.column.status");
  expect(wrapper.text()).toContain("serviceVersions.compare.pods.column.ready");
  expect(wrapper.text()).toContain("serviceVersions.compare.pods.column.requests");
});
it("names the requests window in whole minutes, as the header's clock window reads", () => {
  const fiveMinutes = {
    ...result,
    arms: { ...result.arms, a: { ...result.arms.a, start_time: 0, end_time: 299_000_000 } },
  } as unknown as CompareResponse;
  const wrapper = mount(Pods, { props: { org: "org", result: fiveMinutes, pods: [pod("p", 1)] } });
  expect(wrapper.text()).toContain(
    `serviceVersions.compare.pods.column.requests {"window":"${formatSpan(300_000_000)}"}`,
  );
});
it("keeps a ready-but-unknown-status pod dashed in Status only", () => {
  const wrapper = render([{ ...pod("otel", 1), ready: false }]);
  expect(wrapper.find(`[data-test="svcver-pod-status-c1/otel-demo/otel"]`).text()).toBe("—");
  expect(wrapper.find(`[data-test="svcver-pod-ready-c1/otel-demo/otel"]`).text()).toBe(
    "serviceVersions.compare.pods.ready.no",
  );
});
it("titles the pods of a scope outside Kubernetes without its default where key", () => {
  const wrapper = mount(Pods, {
    props: { org: "org", result: { ...result, where_key: "default" }, pods: [pod("cron-1", 1)] },
  });
  const title = wrapper.get('[data-test="svcver-pods"] span').text();
  expect(title).toBe("serviceVersions.compare.pods.titleOutside {}");
  expect(title).not.toMatch(/default/i);
});
