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

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import FleetCollectorDrawer from "./FleetCollectorDrawer.vue";
import { apiDetail } from "./fleet.fixtures";

const { confirmMock, toastMock } = vi.hoisted(() => ({ confirmMock: vi.fn(), toastMock: vi.fn() }));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: {
    getCollector: vi.fn(),
    listTokens: vi.fn(),
    listFleets: vi.fn(),
    deleteCollector: vi.fn(),
    restartCollector: vi.fn(),
    redeliverCollector: vi.fn(),
    renameCollector: vi.fn(),
  },
}));

const MetricsStub = {
  name: "FleetCollectorMetrics",
  props: ["collectorId", "collectorName"],
  template: '<div data-test="metrics-stub" />',
};

const EFFECTIVE = `receivers:
  otlp: {}
extensions:
  health_check: {}
  opamp:
    server:
      ws:
        endpoint: wss://o2/api/default/v1/opamp
service:
  extensions: [health_check, opamp]
  pipelines:
    logs:
      receivers: [otlp]
      exporters: [debug]
  telemetry:
    resource:
      attributes:
        - name: openobserve.fleet.config_id
          value: edge
`;

const detail = (over: Parameters<typeof apiDetail>[0] = {}) =>
  apiDetail({
    name: "prod-web-01",
    hostname: "prod-web-01.acme.internal",
    last_connected_from: "10.0.0.10",
    token_id: "t1",
    capabilities: ["AcceptsRemoteConfig", "AcceptsRestartCommand"],
    health: {
      healthy: false,
      status: "StatusRecoverableError",
      last_error: "exporter:otlphttp/openobserve: 401 Unauthorized",
      components: [
        { id: "receiver:otlp", healthy: true, status: "StatusOK", last_error: "" },
        {
          id: "exporter:otlphttp/openobserve",
          healthy: false,
          status: "StatusPermanentError",
          last_error: "401 Unauthorized",
        },
      ],
    },
    effective_config: EFFECTIVE,
    effective_reported_at: Date.now(),
    assignment: { fleet: "default", config: "edge", version: 2, revision: 7 },
    evidence: {
      remote_status: "APPLIED",
      remote_hash: "9f2c1a7e",
      remote_at: Date.now(),
      marker: { config: "edge", version: 2 },
      last_heartbeat_at: Date.now(),
    },
    history: [
      { at: 1, event: "enrolled", detail: null },
      { at: 3, event: "moved_by_token", detail: "from staging" },
    ],
    ...over,
  });

const DrawerStub = {
  props: ["open", "title", "subTitle"],
  template: '<div data-test="drawer-stub"><h2>{{ title }}</h2><slot /></div>',
};
const CodeStub = {
  props: ["code"],
  template: "<pre>{{ code }}</pre>",
};
const MoveStub = {
  name: "FleetMoveDialog",
  props: ["open", "collectorIds", "sourceFleetId"],
  template: "<div />",
};

function mountDrawer(initialTab = "overview") {
  return mount(FleetCollectorDrawer, {
    props: { open: true, collectorId: "c1", initialTab },
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: DrawerStub,
        FleetCodeEditor: CodeStub,
        FleetMoveDialog: MoveStub,
        FleetCollectorMetrics: MetricsStub,
      },
    },
  });
}

const org = () => store.state.selectedOrganization.identifier;
const sel = (name: string) => `[data-test="fleet-collector-drawer-${name}"]`;

describe("FleetCollectorDrawer", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    confirmMock.mockResolvedValue(true);
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    vi.mocked(fleet.listTokens).mockResolvedValue({
      data: {
        items: [
          {
            id: "t1",
            name: "k8s-helm",
            prefix: "o2ft_Qm7x",
            created_at: 1,
            expires_at: null,
            uses: 1,
            max_uses: null,
            fleet: { id: "default", name: "default" },
            revoked: false,
          },
        ],
      },
    } as any);
    vi.mocked(fleet.listFleets).mockResolvedValue({ data: { items: [] } } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("fetches the detail for the org and collector", async () => {
    wrapper = mountDrawer();
    await flushPromises();
    expect(fleet.getCollector).toHaveBeenCalledWith(org(), "c1");
  });

  it("does not fetch while closed", async () => {
    wrapper = mount(FleetCollectorDrawer, {
      props: { open: false, collectorId: "c1" },
      global: { plugins: [i18n, store], stubs: { ODrawer: DrawerStub } },
    });
    await flushPromises();
    expect(fleet.getCollector).not.toHaveBeenCalled();
  });

  it.each([
    [{ response: { status: 403 } }, "forbidden"],
    [new Error("boom"), "error"],
  ])("shows why the detail cannot load (%j)", async (err, shown) => {
    vi.mocked(fleet.getCollector).mockRejectedValue(err);
    wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find(sel(shown)).exists()).toBe(true);
  });

  it("shows where it last connected from and the token by name", async () => {
    wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find(sel("peer")).text()).toBe("10.0.0.10");
    expect(wrapper.find(sel("token")).text()).toBe("k8s-helm (o2ft_Qm7x)");
    expect(wrapper.find(sel("id")).text()).toBe("c1");
  });

  it("renames the collector when the nickname is committed", async () => {
    vi.mocked(fleet.renameCollector).mockResolvedValue({ data: {} } as any);
    wrapper = mountDrawer();
    await flushPromises();
    wrapper.findComponent({ name: "OInlineEdit" }).vm.$emit("commit", "web-primary");
    await flushPromises();
    expect(fleet.renameCollector).toHaveBeenCalledWith(org(), "c1", "web-primary");
  });

  it("traces delivery to the assignment, the remote status and the marker under Overview", async () => {
    wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find(sel("assignment")).text()).toBe("edge v2, revision 7");
    expect(wrapper.find(sel("remote")).text()).toContain("APPLIED");
    expect(wrapper.find(sel("remote-hash")).text()).toContain("9f2c1a7e");
    expect(wrapper.find(sel("marker")).text()).toBe("edge v2");
    const labels = wrapper.findAll("dt").map((el) => el.text());
    expect(labels.at(-1)).toBe("OpAMP capabilities");
    expect(labels).not.toContain("Assignment");
  });

  it("mutes delivery for an offline collector and says when it last reported", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({
      data: detail({ status: "offline", delivery: "running" }),
    } as any);
    wrapper = mountDrawer();
    await flushPromises();
    const delivery = wrapper.find(sel("delivery"));
    expect(delivery.text()).toContain("Running");
    expect(delivery.findComponent({ name: "OBadge" }).props("variant")).toBe("default-outline");
    expect(wrapper.find(sel("delivery-offline")).text()).toContain(
      "Last reported before going offline:",
    );
  });

  it("shows a rejection's error and the placeholder for an unassigned fleet", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({
      data: detail({
        delivery: "rejected",
        delivery_error: "unknown field endpiont",
        assignment: null,
        evidence: null,
      }),
    } as any);
    wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find(sel("delivery-error")).text()).toContain("unknown field endpiont");
    expect(wrapper.find(sel("assignment")).text()).toContain("Placeholder configuration");
    expect(wrapper.find(sel("marker")).text()).toBe("not reported");
  });

  it("renders the health error and per-component health", async () => {
    wrapper = mountDrawer("health");
    await flushPromises();
    expect(wrapper.find(sel("errors")).text()).toContain("401 Unauthorized");
    expect(wrapper.find(sel("components")).text()).toContain("exporter:otlphttp/openobserve");
  });

  it("collapses the system-managed sections out of the effective config", async () => {
    wrapper = mountDrawer("config");
    await flushPromises();
    const user = wrapper.find(sel("yaml")).text();
    expect(user).toContain("health_check");
    expect(user).not.toContain("opamp:");
    expect(user).not.toContain("telemetry");
    expect(wrapper.find(sel("system-yaml")).exists()).toBe(true);
  });

  it("shows an empty state without an effective config", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({
      data: detail({ effective_config: null }),
    } as any);
    wrapper = mountDrawer("config");
    await flushPromises();
    expect(wrapper.find(sel("no-yaml")).exists()).toBe(true);
  });

  it("lists the history newest first, with moves by token named", async () => {
    wrapper = mountDrawer("history");
    await flushPromises();
    const text = wrapper.find(sel("history")).text();
    expect(text.indexOf("Moved by its enrollment token")).toBeLessThan(text.indexOf("Enrolled"));
    expect(text).toContain("from staging");
  });

  it("restarts and redelivers the collector", async () => {
    vi.mocked(fleet.restartCollector).mockResolvedValue({ data: { queued: true } } as any);
    vi.mocked(fleet.redeliverCollector).mockResolvedValue({ data: { revision: 8 } } as any);
    wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find(sel("restart")).trigger("click");
    await wrapper.find(sel("redeliver")).trigger("click");
    await flushPromises();
    expect(fleet.restartCollector).toHaveBeenCalledWith(org(), "c1");
    expect(fleet.redeliverCollector).toHaveBeenCalledWith(org(), "c1");
  });

  it("disables restart for a collector that does not accept the command", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({
      data: detail({ capabilities: ["AcceptsRemoteConfig"] }),
    } as any);
    wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find(sel("restart")).attributes("disabled")).toBeDefined();
  });

  it("removes after a confirm that warns an online host comes back, and closes", async () => {
    vi.mocked(fleet.deleteCollector).mockResolvedValue({ status: 204 } as any);
    wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find(sel("remove")).trigger("click");
    await flushPromises();
    expect(confirmMock.mock.calls[0][0].message).toContain("reappears on its next heartbeat");
    expect(fleet.deleteCollector).toHaveBeenCalledWith(org(), "c1");
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("keeps the drawer open when the remove is cancelled", async () => {
    confirmMock.mockResolvedValue(false);
    wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find(sel("remove")).trigger("click");
    await flushPromises();
    expect(fleet.deleteCollector).not.toHaveBeenCalled();
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });

  it("moves this collector, naming its fleet as the source", async () => {
    wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find(sel("move")).trigger("click");
    const move = wrapper.findComponent(MoveStub);
    expect(move.props("open")).toBe(true);
    expect(move.props("collectorIds")).toEqual(["c1"]);
    expect(move.props("sourceFleetId")).toBe("default");
  });

  it("closes itself when the org changes", async () => {
    const orgA = store.state.selectedOrganization;
    wrapper = mountDrawer();
    await flushPromises();
    store.commit("setSelectedOrganization", { ...orgA, identifier: "org-b" });
    await flushPromises();
    try {
      expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    } finally {
      store.commit("setSelectedOrganization", orgA);
    }
  });

  it("switches tab when initialTab changes while open", async () => {
    wrapper = mountDrawer();
    await flushPromises();
    await wrapper.setProps({ initialTab: "history" });
    await flushPromises();
    expect(wrapper.find(sel("history")).exists()).toBe(true);
  });

  it("puts metrics right after overview, scoped to this collector", async () => {
    wrapper = mountDrawer();
    await flushPromises();
    const names = wrapper.findAllComponents({ name: "OTab" }).map((tab) => tab.props("name"));
    expect(names).toEqual(["overview", "metrics", "health", "config", "history"]);
    expect(wrapper.findComponent(MetricsStub).exists()).toBe(false);

    await wrapper.setProps({ initialTab: "metrics" });
    await flushPromises();
    const metrics = wrapper.findComponent(MetricsStub);
    expect(metrics.props()).toEqual({ collectorId: "c1", collectorName: "prod-web-01" });
  });
});
