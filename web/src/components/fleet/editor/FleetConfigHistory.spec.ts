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
import fleet, { type FleetConfigVersionSummary } from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import FleetConfigHistory from "./FleetConfigHistory.vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({ default: { getConfigVersion: vi.fn() } }));

const summary = (version: number, over: Partial<FleetConfigVersionSummary> = {}) => ({
  version,
  author: "ana@acme.io",
  at: Date.now(),
  message: `release ${version}`,
  live: false,
  state: "published" as const,
  ...over,
});

const YAML: Record<number, string> = {
  1: "receivers:\n  otlp: {}\n",
  2: "receivers:\n  otlp: {}\n  zipkin: {}\n",
  3: "receivers:\n  zipkin: {}\n",
};

describe("FleetConfigHistory", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(fleet.getConfigVersion).mockImplementation(
      async (_org: string, _id: string, v: number) =>
        ({ data: { version: v, yaml: YAML[v], hash: "ab" } }) as any,
    );
  });

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  async function mountHistory(versions: FleetConfigVersionSummary[]) {
    wrapper = mount(FleetConfigHistory, {
      props: { configId: "edge", versions },
      global: {
        plugins: [i18n, store],
        stubs: {
          FleetNewRolloutDialog: {
            name: "FleetNewRolloutDialog",
            props: ["open", "config", "toVersion", "fleetId"],
            template: "<div />",
          },
        },
      },
    });
    await flushPromises();
    return wrapper;
  }

  const requested = () => vi.mocked(fleet.getConfigVersion).mock.calls.map((c) => c[2]);

  it("compares a version with the one before it", async () => {
    await mountHistory([summary(3), summary(2), summary(1)]);
    await wrapper.find('[data-test="fleet-config-history-compare-2"]').trigger("click");
    await flushPromises();
    expect(requested()).toEqual(expect.arrayContaining([1, 2]));
    const diff = wrapper.find('[data-test="fleet-config-diff"]');
    expect(diff.exists()).toBe(true);
    expect(diff.text()).toContain("zipkin: {}");
    expect(wrapper.text()).toContain("Changes from v1 to v2");
  });

  it("never requests the old selection's versions under a new config id", async () => {
    await mountHistory([summary(3), summary(2), summary(1)]);
    await wrapper.find('[data-test="fleet-config-history-compare-2"]').trigger("click");
    await flushPromises();
    vi.mocked(fleet.getConfigVersion).mockClear();
    await wrapper.setProps({ configId: "edge-copy", versions: [] });
    await flushPromises();
    await wrapper.setProps({ versions: [summary(1)] });
    await flushPromises();
    expect(vi.mocked(fleet.getConfigVersion).mock.calls).toEqual([]);
  });

  it("requests no version 0 and renders no diff for a single version", async () => {
    await mountHistory([summary(1)]);
    expect(requested()).not.toContain(0);
    expect(wrapper.find('[data-test="fleet-config-diff"]').exists()).toBe(false);
    expect(
      wrapper.find('[data-test="fleet-config-history-compare-1"]').attributes("disabled"),
    ).toBeDefined();
  });

  const dialog = () => wrapper.findComponent({ name: "FleetNewRolloutDialog" });

  it.each([2, 1])("opens the Deploy dialog for version %s", async (version) => {
    await mountHistory([summary(2), summary(1)]);
    expect(dialog().props("open")).toBe(false);
    const btn = wrapper.find(`[data-test="fleet-config-history-start-${version}"]`);
    expect(btn.text()).toBe("Deploy");
    await btn.trigger("click");
    await flushPromises();
    expect(dialog().props()).toMatchObject({ open: true, config: "edge", toVersion: version });
  });

  it("offers Deploy to everyone, leaving the fleet to pick, and no second name for it", async () => {
    await mountHistory([summary(2), summary(1)]);
    for (const sel of ["start-2", "start-1"]) {
      const btn = wrapper.find(`[data-test="fleet-config-history-${sel}"]`);
      expect(btn.attributes("aria-disabled")).toBeUndefined();
    }
    expect(wrapper.text()).not.toContain("Roll back");
    expect(dialog().props("fleetId")).toBeUndefined();
  });

  const tag = (v: number) => wrapper.find(`[data-test="fleet-config-history-state-${v}"]`);
  const has = (sel: string) => wrapper.find(`[data-test="fleet-config-history-${sel}"]`).exists();

  it("tags a published version as just Published, since a once-live version is published too", async () => {
    await mountHistory([summary(2, { live: true, state: null }), summary(1)]);
    expect(tag(1).text()).toBe("Published");
    expect(wrapper.text()).not.toContain("not rolled out");
  });

  it("tags rolling-out versions with their state", async () => {
    await mountHistory([
      summary(2, { state: "rolling_out" }),
      summary(1, { live: true, state: null }),
    ]);
    expect(tag(2).text()).toBe("Rolling out");
    expect(tag(1).exists()).toBe(false);
  });

  it("offers no Deploy on a version that is rolling out", async () => {
    await mountHistory([
      summary(2, { state: "rolling_out" }),
      summary(1, { live: true, state: null }),
    ]);
    expect(has("start-2")).toBe(false);
  });

  it("offers no Deploy on the live version", async () => {
    await mountHistory([summary(2), summary(1, { live: true })]);
    expect(has("start-1")).toBe(false);
  });

  it("shows a spinner while the compared versions load", async () => {
    vi.mocked(fleet.getConfigVersion).mockReturnValue(new Promise(() => {}) as any);
    await mountHistory([summary(2), summary(1)]);
    expect(wrapper.find('[data-test="fleet-config-history-diff-loading"]').exists()).toBe(true);
  });

  it.each([
    [{ response: { status: 403 } }, "fleet-config-history-diff-forbidden"],
    [{ response: { status: 500 } }, "fleet-config-history-diff-error"],
  ])("shows why the diff cannot load (%j)", async (err, shown) => {
    vi.mocked(fleet.getConfigVersion).mockRejectedValue(err);
    await mountHistory([summary(2), summary(1)]);
    expect(wrapper.find(`[data-test="${shown}"]`).exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-config-diff"]').exists()).toBe(false);
  });

  it("retries a diff that failed to load", async () => {
    vi.mocked(fleet.getConfigVersion).mockRejectedValueOnce({ response: { status: 500 } });
    await mountHistory([summary(2), summary(1)]);
    wrapper.findComponent('[data-test="fleet-config-history-diff-error"]').vm.$emit("action");
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-config-diff"]').exists()).toBe(true);
  });
});
