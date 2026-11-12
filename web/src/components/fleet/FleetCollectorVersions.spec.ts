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
import { queryClient } from "@/composables/query/queryClient";
import FleetCollectorVersions from "./FleetCollectorVersions.vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: { listCollectors: vi.fn(), getCollector: vi.fn(), summary: vi.fn() },
}));

const collector = (over: Record<string, unknown>) => ({
  id: "c1",
  name: "prod-web-01",
  hostname: null,
  last_connected_from: null,
  status: "online",
  os: "linux",
  arch: null,
  distribution: null,
  version: "0.124.0",
  outdated: false,
  config: null,
  config_version: null,
  delivery: null,
  delivery_error: null,
  fleet: { id: "default", name: "default" },
  token_id: null,
  last_seen: Date.now(),
  enrolled_at: Date.now(),
  ...over,
});

const items = [
  collector({}),
  collector({ id: "c2", name: "edge-02", version: "0.118.0", outdated: true }),
  // The server did not flag this one, so the UI must not either.
  collector({ id: "c3", name: "odd-03", version: "0.99.1", outdated: false }),
];

const summary = {
  collectors: { total: 3, online: 3, degraded: 0, offline: 0, drifted: 0, outdated: 1 },
  versions: [
    { version: "0.124.0", count: 1 },
    { version: "0.118.0", count: 1 },
    { version: "0.99.1", count: 1 },
  ],
  target_version: "0.124.0",
  labels: [],
  rollouts_active: 0,
};

const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 100));
  await flushPromises();
};

async function mountVersions() {
  const wrapper = mount(FleetCollectorVersions, {
    attachTo: document.body,
    global: {
      plugins: [i18n, store],
    },
  });
  await settle();
  return wrapper;
}

const refresh = () => queryClient.refetchQueries({ type: "active" });

const barVariant = (w: VueWrapper, version: string) =>
  w
    .find(`[data-test="fleet-version-bars-row-${version}"]`)
    .findComponent({ name: "OProgressBar" })
    .props("variant");

describe("FleetCollectorVersions", () => {
  let wrapper: VueWrapper;

  const ok = () => {
    vi.mocked(fleet.listCollectors).mockResolvedValue({ data: { total: 3, items } } as any);
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
  };

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("lists only the collectors the server flags outdated", async () => {
    ok();
    wrapper = await mountVersions();
    const table = wrapper.find('[data-test="fleet-collector-versions-outdated-table"]');
    expect(table.text()).toContain("edge-02");
    expect(table.text()).not.toContain("prod-web-01");
    expect(table.text()).not.toContain("odd-03");
    expect(table.text()).toContain("0.124.0");
  });

  it("colours version bars from the server's outdated flags", async () => {
    ok();
    wrapper = await mountVersions();
    expect(barVariant(wrapper, "0.118.0")).toBe("warning");
    expect(barVariant(wrapper, "0.124.0")).toBe("success");
    expect(barVariant(wrapper, "0.99.1")).toBe("success");
  });

  it("offers no upgrade or schedule action, since none has an API", async () => {
    ok();
    wrapper = await mountVersions();
    expect(wrapper.find('[data-test^="fleet-collector-versions-upgrade"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: "OTable" }).props("selection")).not.toBe("multiple");
    expect(wrapper.text()).not.toContain("Upgrade");
    expect(wrapper.text()).not.toContain("Schedule upgrade");
  });

  it("leaves out the outdated collectors when none are outdated", async () => {
    vi.mocked(fleet.listCollectors).mockResolvedValue({
      data: { total: 1, items: [collector({})] },
    } as any);
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    wrapper = await mountVersions();
    expect(wrapper.find('[data-test="fleet-collector-versions-outdated"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-version-bars-row-0.124.0"]').exists()).toBe(true);
  });

  it("shows the no-access state when the list is forbidden", async () => {
    vi.mocked(fleet.listCollectors).mockRejectedValue({ response: { status: 403 } });
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    wrapper = await mountVersions();
    expect(wrapper.find('[data-test="o2-table-forbidden"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-collector-versions-outdated-error"]').exists()).toBe(
      false,
    );
  });

  it("shows no-access and drops cached rows when a list refetch returns 403", async () => {
    ok();
    wrapper = await mountVersions();
    vi.mocked(fleet.listCollectors).mockRejectedValueOnce({ response: { status: 403 } });
    await refresh();
    await settle();
    expect(wrapper.find('[data-test="o2-table-forbidden"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-test="fleet-collector-versions-outdated-table"]').text(),
    ).not.toContain("edge-02");
  });

  it("shows a dash, not 0, for the outdated count after a list 403", async () => {
    vi.mocked(fleet.listCollectors).mockRejectedValue({ response: { status: 403 } });
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    wrapper = await mountVersions();
    expect(wrapper.find('[data-test="fleet-collector-versions-outdated-count"]').text()).toBe("—");
  });

  it("keeps cached bars with an inline error when a summary refresh fails", async () => {
    ok();
    wrapper = await mountVersions();
    vi.mocked(fleet.summary).mockRejectedValueOnce(new Error("boom"));
    await refresh();
    await settle();
    expect(wrapper.find('[data-test="fleet-collector-versions-distribution-stale"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="fleet-version-bars-row-0.118.0"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-collector-versions-distribution-error"]').exists()).toBe(
      false,
    );
  });

  it("retries a failed distribution load from its inline error", async () => {
    ok();
    vi.mocked(fleet.summary).mockRejectedValueOnce(new Error("boom"));
    wrapper = await mountVersions();
    const error = wrapper.find('[data-test="fleet-collector-versions-distribution-error"]');
    expect(error.text()).toContain(i18n.global.t("emptyState.loadError.action"));
    await error.find("button").trigger("click");
    await settle();
    expect(fleet.summary).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="fleet-collector-versions-distribution-error"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="fleet-version-bars-row-0.118.0"]').exists()).toBe(true);
  });

  it("keeps the cached outdated colouring when a list refresh fails", async () => {
    ok();
    wrapper = await mountVersions();
    vi.mocked(fleet.listCollectors).mockRejectedValueOnce(new Error("boom"));
    await refresh();
    await settle();
    expect(barVariant(wrapper, "0.118.0")).toBe("warning");
    expect(barVariant(wrapper, "0.124.0")).toBe("success");
  });

  it("scrolls to the outdated collectors when shown, else to the versions block", async () => {
    const original = Element.prototype.scrollIntoView;
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const scrollToOutdated = (w: VueWrapper) =>
      (w.vm as unknown as { scrollToOutdated: () => void }).scrollToOutdated();
    try {
      ok();
      wrapper = await mountVersions();
      scrollToOutdated(wrapper);
      expect(scroll.mock.contexts[0]).toBe(
        wrapper.find('[data-test="fleet-collector-versions-outdated"]').element,
      );
      wrapper.unmount();
      queryClient.clear();
      vi.mocked(fleet.listCollectors).mockResolvedValue({
        data: { total: 1, items: [collector({})] },
      } as any);
      wrapper = await mountVersions();
      scrollToOutdated(wrapper);
      expect(scroll.mock.contexts[1]).toBe(
        wrapper.find('[data-test="fleet-collector-versions"]').element,
      );
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("refreshCollectors re-reads the list only, since its parent owns the summary", async () => {
    ok();
    wrapper = await mountVersions();
    await (
      wrapper.vm as unknown as { refreshCollectors: () => Promise<unknown> }
    ).refreshCollectors();
    await settle();
    expect(fleet.listCollectors).toHaveBeenCalledTimes(2);
    expect(fleet.summary).toHaveBeenCalledTimes(1);
  });

  it("keeps version bars neutral while the list is loading", async () => {
    vi.mocked(fleet.listCollectors).mockReturnValue(new Promise(() => {}) as any);
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    wrapper = await mountVersions();
    expect(barVariant(wrapper, "0.118.0")).toBe("default");
    expect(barVariant(wrapper, "0.124.0")).toBe("default");
  });

  it.each([new Error("boom"), { response: { status: 403 } }])(
    "keeps version bars neutral when the list fails (%j)",
    async (err) => {
      vi.mocked(fleet.listCollectors).mockRejectedValue(err);
      vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
      wrapper = await mountVersions();
      expect(barVariant(wrapper, "0.118.0")).toBe("default");
    },
  );

  it("shows the load error when the list fails", async () => {
    vi.mocked(fleet.listCollectors).mockRejectedValue(new Error("boom"));
    vi.mocked(fleet.summary).mockResolvedValue({ data: summary } as any);
    wrapper = await mountVersions();
    expect(wrapper.find('[data-test="fleet-collector-versions-outdated-error"]').exists()).toBe(
      true,
    );
  });
});
