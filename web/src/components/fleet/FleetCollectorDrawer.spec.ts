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

import { describe, it, expect, vi, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import FleetCollectorDrawer from "./FleetCollectorDrawer.vue";

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
    listCollectors: vi.fn(),
    getCollector: vi.fn(),
    summary: vi.fn(),
    unenrollCollector: vi.fn(),
  },
}));

const detail = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "prod-web-01",
  hostname: "prod-web-01.acme.internal",
  ip: "10.0.0.10",
  status: "degraded",
  os: "linux",
  arch: "amd64",
  distribution: "Ubuntu 24.04",
  version: "0.124.0",
  outdated: false,
  config: null,
  config_version: null,
  delivery: null,
  drifted: null,
  fleet: { id: "f1", name: "edge" },
  token_id: null,
  last_seen: Date.now(),
  enrolled_at: Date.now(),
  capabilities: ["ReportsStatus", "ReportsHealth"],
  health: {
    healthy: false,
    status: "StatusRecoverableError",
    last_error: "",
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
  errors: ["exporter:otlphttp/openobserve: 401 Unauthorized"],
  delivery_error: null,
  effective_config: null,
  assigned_at: null,
  applied_at: null,
  drift_since: null,
  baseline_config: null,
  ...over,
});

const MoveStub = {
  name: "MoveAcrossFolders",
  props: ["open", "activeFolderId", "moduleId", "type"],
  emits: ["updated", "update:open"],
  template: "<div />",
};

const DrawerStub = {
  props: ["open", "title", "subTitle"],
  template: '<div data-test="drawer-stub"><h2>{{ title }}</h2><slot /></div>',
};
const CodeStub = {
  props: ["code"],
  template: '<pre data-test="fleet-collector-drawer-yaml">{{ code }}</pre>',
};

function mountDrawer(initialTab = "overview") {
  return mount(FleetCollectorDrawer, {
    props: { open: true, collectorId: "c1", initialTab },
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: DrawerStub,
        FleetCodeEditor: CodeStub,
        MoveAcrossFolders: MoveStub,
      },
    },
  });
}

describe("FleetCollectorDrawer", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("fetches the detail for the org and collector", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    wrapper = mountDrawer();
    await flushPromises();
    expect(fleet.getCollector).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
      "c1",
    );
  });

  it("does not fetch while closed", async () => {
    wrapper = mount(FleetCollectorDrawer, {
      props: { open: false, collectorId: "c1" },
      global: { plugins: [i18n, store], stubs: { ODrawer: DrawerStub } },
    });
    await flushPromises();
    expect(fleet.getCollector).not.toHaveBeenCalled();
  });

  it("shows a spinner while the detail loads", async () => {
    vi.mocked(fleet.getCollector).mockReturnValue(new Promise(() => {}) as any);
    wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-loading"]').exists()).toBe(true);
  });

  it("shows the no-access state on a 403", async () => {
    vi.mocked(fleet.getCollector).mockRejectedValue({ response: { status: 403 } });
    wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-forbidden"]').exists()).toBe(true);
  });

  it("shows no-access over cached detail when a refetch returns 403", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValueOnce({ data: detail() } as any);
    wrapper = mountDrawer();
    await flushPromises();
    vi.mocked(fleet.getCollector).mockRejectedValueOnce({ response: { status: 403 } });
    await (wrapper.vm as any).refetch();
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-forbidden"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-collector-drawer-id"]').exists()).toBe(false);
  });

  it("keeps the cached collector on screen when a refetch fails", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValueOnce({ data: detail() } as any);
    wrapper = mountDrawer();
    await flushPromises();
    vi.mocked(fleet.getCollector).mockRejectedValueOnce(new Error("boom"));
    await (wrapper.vm as any).refetch();
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-collector-drawer-id"]').text()).toBe("c1");
  });

  it("shows the error state when the detail fails", async () => {
    vi.mocked(fleet.getCollector).mockRejectedValue({ response: { status: 404 } });
    wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-error"]').exists()).toBe(true);
  });

  it("renders the overview from API data", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find("h2").text()).toBe("prod-web-01");
    expect(wrapper.find('[data-test="fleet-collector-drawer-id"]').text()).toBe("c1");
    expect(wrapper.find('[data-test="fleet-collector-drawer-os"]').text()).toBe(
      "Ubuntu 24.04 · amd64",
    );
    expect(wrapper.find('[data-test="fleet-collector-drawer-capabilities"]').text()).toContain(
      "ReportsHealth",
    );
  });

  it("renders the fleet row and an empty state for a null config, with no label editor", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-config"]').text()).toBe(
      "No configuration assigned",
    );
    expect(wrapper.find('[data-test="fleet-collector-drawer-fleet"]').text()).toBe("edge");
    expect(wrapper.find('[data-test="fleet-collector-drawer-edit-labels"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-collector-drawer-labels"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("undefined");
    expect(wrapper.text()).not.toContain("null");
  });

  it("renders a dash for a missing OS line", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({
      data: detail({ os: null, arch: null, distribution: null }),
    } as any);
    wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-os"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("—");
  });

  it("renders none of the removed controls: restart and remediate", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail({ drifted: true }) } as any);
    wrapper = mountDrawer("config");
    await flushPromises();
    expect(wrapper.text()).toContain("differs from the assigned version");
    expect(wrapper.find('[data-test="fleet-collector-drawer-restart"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-collector-drawer-remediate"]').exists()).toBe(false);
  });

  it("renders errors and per-component health on the health tab", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    wrapper = mountDrawer("health");
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-errors"]').text()).toContain(
      "401 Unauthorized",
    );
    const components = wrapper.find('[data-test="fleet-collector-drawer-components"]').text();
    expect(components).toContain("receiver:otlp");
    expect(components).toContain("exporter:otlphttp/openobserve");
  });

  it("shows a neutral no-health state, not a green all-clear, when health is null", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({
      data: detail({ health: null, errors: [] }),
    } as any);
    wrapper = mountDrawer("health");
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-no-health"]').text()).toContain(
      "No health reported",
    );
    expect(wrapper.find('[data-test="fleet-collector-drawer-no-errors"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-collector-drawer-components"]').text()).toBe(
      "No component health reported",
    );
  });

  it("labels an offline collector's errors as last reported, with components unknown", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail({ status: "offline" }) } as any);
    wrapper = mountDrawer("health");
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-last-reported"]').text()).toBe(
      "Last reported",
    );
    expect(wrapper.find('[data-test="fleet-collector-drawer-errors"]').text()).toContain(
      "401 Unauthorized",
    );
    const tags = wrapper
      .find('[data-test="fleet-collector-drawer-components"]')
      .findAllComponents({ name: "OTag" });
    expect(tags.map((t) => t.props("value"))).toEqual(["unknown", "unknown"]);
  });

  it("does not label an online collector's errors as last reported", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    wrapper = mountDrawer("health");
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-last-reported"]').exists()).toBe(false);
  });

  it("renders the reported YAML on the effective config tab", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({
      data: detail({ effective_config: { yaml: "receivers:\n  otlp: {}", reported_at: 1 } }),
    } as any);
    wrapper = mountDrawer("config");
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-yaml"]').text()).toContain("otlp");
  });

  it("renders empty states for a null effective config and delivery", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    wrapper = mountDrawer("config");
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-no-yaml"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-collector-drawer-delivery"]').text()).toBe("—");
    expect(wrapper.text()).not.toContain("undefined");
  });

  it.each(["online", "offline"])(
    "builds history from real timestamps only (%s)",
    async (status) => {
      vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail({ status }) } as any);
      wrapper = mountDrawer("history");
      await flushPromises();
      const titles = wrapper
        .findAllComponents({ name: "OTimelineItem" })
        .map((i) => i.props("title"));
      expect(titles).toEqual(["Last seen", "Enrolled"]);
      expect(wrapper.text()).not.toContain("Went offline");
    },
  );

  it("says the assignment comes through the collector's fleet", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({
      data: detail({ config: "edge-config", config_version: 3, delivery: "running" }),
    } as any);
    wrapper = mountDrawer("config");
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-assignment"]').text()).toBe(
      "Through fleet edge → edge-config v3",
    );
  });

  it("moves this collector from Move to fleet, naming its fleet as the source", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    wrapper = mountDrawer();
    await flushPromises();
    const dialog = wrapper.findComponent({ name: "MoveAcrossFolders" });
    expect(dialog.props("open")).toBe(false);
    expect(wrapper.find('[data-test="fleet-collector-drawer-apply"]').exists()).toBe(false);
    await wrapper.find('[data-test="fleet-collector-drawer-move"]').trigger("click");
    await flushPromises();
    expect(dialog.props()).toMatchObject({
      open: true,
      type: "fleets",
      moduleId: ["c1"],
      activeFolderId: "f1",
    });
  });

  it("shows a collector moved to a fleet with no stable version as unassigned with its delivery", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({
      data: detail({ config: null, delivery: "running", drifted: false }),
    } as any);
    wrapper = mountDrawer();
    await flushPromises();
    const cell = wrapper.find('[data-test="fleet-collector-drawer-config"]');
    expect(cell.text()).toContain("No configuration assigned");
    expect(cell.text()).toContain("Running");
    await wrapper.setProps({ initialTab: "config" });
    await flushPromises();
  });

  it("diffs the baseline against the current effective config when drifted", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({
      data: detail({
        config: "edge",
        config_version: 1,
        delivery: "running",
        drifted: true,
        baseline_config: "receivers:\n  otlp: {}\n",
        effective_config: { yaml: "receivers:\n  zipkin: {}\n", reported_at: Date.now() },
      }),
    } as any);
    wrapper = mountDrawer("config");
    await flushPromises();
    const diff = wrapper.find('[data-test="fleet-config-diff"]');
    expect(diff.exists()).toBe(true);
    expect(diff.text()).toContain("otlp: {}");
    expect(diff.text()).toContain("zipkin: {}");
  });

  it("shows no diff without a baseline", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({
      data: detail({
        drifted: true,
        effective_config: { yaml: "a: 1\n", reported_at: Date.now() },
      }),
    } as any);
    wrapper = mountDrawer("config");
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-config-diff"]').exists()).toBe(false);
  });

  it("adds assigned, applied and drift events to the history", async () => {
    const now = Date.now();
    vi.mocked(fleet.getCollector).mockResolvedValue({
      data: detail({
        last_seen: now,
        enrolled_at: now - 40_000,
        assigned_at: now - 30_000,
        applied_at: now - 20_000,
        drift_since: now - 10_000,
      }),
    } as any);
    wrapper = mountDrawer("history");
    await flushPromises();
    const titles = wrapper
      .findAllComponents({ name: "OTimelineItem" })
      .map((i) => i.props("title"));
    expect(titles).toEqual([
      "Last seen",
      "Drift detected",
      "Configuration applied",
      "Configuration assigned",
      "Enrolled",
    ]);
  });

  it("unenrolls after a confirm and closes the drawer", async () => {
    confirmMock.mockResolvedValue(true);
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    vi.mocked(fleet.unenrollCollector).mockResolvedValue({ status: 204 } as any);
    wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find('[data-test="fleet-collector-drawer-unenroll"]').trigger("click");
    await flushPromises();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(fleet.unenrollCollector).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
      "c1",
    );
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    expect(confirmMock.mock.calls[0][0]).toMatchObject({
      confirmVariant: "destructive",
      focusCancel: true,
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", message: "Unenrolled prod-web-01" }),
    );
  });

  it("keeps the drawer open when the unenroll is cancelled or fails", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    wrapper = mountDrawer();
    await flushPromises();
    confirmMock.mockResolvedValueOnce(false);
    await wrapper.find('[data-test="fleet-collector-drawer-unenroll"]').trigger("click");
    await flushPromises();
    expect(fleet.unenrollCollector).not.toHaveBeenCalled();
    confirmMock.mockResolvedValueOnce(true);
    vi.mocked(fleet.unenrollCollector).mockRejectedValue({ response: { status: 403 } });
    await wrapper.find('[data-test="fleet-collector-drawer-unenroll"]').trigger("click");
    await flushPromises();
    expect(fleet.unenrollCollector).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });

  it("shows the server's reason when an unenroll is refused", async () => {
    confirmMock.mockResolvedValue(true);
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    vi.mocked(fleet.unenrollCollector).mockRejectedValue({
      response: {
        status: 403,
        data: { message: "Only organization administrators can manage enrollment" },
      },
    });
    wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find('[data-test="fleet-collector-drawer-unenroll"]').trigger("click");
    await flushPromises();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: "Only organization administrators can manage enrollment",
      }),
    );
  });

  it("offers unenroll to everyone, leaving refusal to the server", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    wrapper = mountDrawer();
    await flushPromises();
    const btn = wrapper.find('[data-test="fleet-collector-drawer-unenroll"]');
    expect(btn.attributes("aria-disabled")).toBeUndefined();
  });

  it("closes itself when the org changes", async () => {
    const orgA = store.state.selectedOrganization;
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    wrapper = mountDrawer();
    await flushPromises();
    store.commit("setSelectedOrganization", { ...orgA, identifier: "org-b" });
    await flushPromises();
    try {
      expect(wrapper.emitted("update:open")).toEqual([[false]]);
    } finally {
      store.commit("setSelectedOrganization", orgA);
    }
  });

  it("does not unenroll in the new org when the org changes while confirming", async () => {
    const orgA = store.state.selectedOrganization;
    let answer!: (v: boolean) => void;
    confirmMock.mockReturnValue(new Promise((r) => (answer = r)));
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    wrapper = mountDrawer();
    await flushPromises();
    await wrapper.find('[data-test="fleet-collector-drawer-unenroll"]').trigger("click");
    await flushPromises();
    store.commit("setSelectedOrganization", { ...orgA, identifier: "org-b" });
    await flushPromises();
    answer(true);
    await flushPromises();
    try {
      expect(fleet.unenrollCollector).not.toHaveBeenCalled();
    } finally {
      store.commit("setSelectedOrganization", orgA);
    }
  });

  it("switches tab when initialTab changes while open", async () => {
    vi.mocked(fleet.getCollector).mockResolvedValue({ data: detail() } as any);
    wrapper = mountDrawer("overview");
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-errors"]').exists()).toBe(false);
    await wrapper.setProps({ initialTab: "health" });
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-collector-drawer-errors"]').exists()).toBe(true);
  });
});
