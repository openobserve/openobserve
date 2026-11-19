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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, h } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import kv from "@/services/kv";
import organizations from "@/services/organizations";

import { PACKS_RETIRED_KEY, packsRetired, resetPackGate, usePackGate } from "./usePackGate";

const summary = (alerts: number, dashboards: number) => ({
  alerts: { num_realtime: 0, num_scheduled: alerts },
  total_dashboards: dashboards,
});

const notFound = () => Object.assign(new Error("missing"), { response: { status: 404 } });

function setup() {
  let gate!: ReturnType<typeof usePackGate>;
  const wrapper = mount(
    defineComponent({
      setup() {
        gate = usePackGate("org1");
        return () => h("div");
      },
    }),
    { global: { plugins: [[VueQueryPlugin, { queryClient }]] } },
  );
  return { gate, wrapper };
}

describe("packsRetired", () => {
  it.each([
    ["no flag and a small org", null, summary(3, 4), false],
    ["more than 10 alerts and more than 10 dashboards", null, summary(11, 11), true],
    ["exactly 10 of each", null, summary(10, 10), false],
    ["many alerts, few dashboards", null, summary(40, 2), false],
    ["many dashboards, few alerts", null, summary(2, 40), false],
    ["the org flag, even with small counts", "1", summary(0, 0), true],
    ["no summary yet", null, undefined, false],
    ["a summary missing its alert counts", null, { total_dashboards: 50 }, false],
  ])("for %s is %s", (_name, flag, counts, expected) => {
    expect(packsRetired(flag, counts)).toBe(expected);
  });
});

describe("usePackGate", () => {
  beforeEach(() => {
    queryClient.clear();
    resetPackGate();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
  });

  it("shows packs while the counts and the flag are unknown", () => {
    vi.spyOn(organizations, "get_organization_summary").mockReturnValue(new Promise(() => {}));
    vi.spyOn(kv, "get").mockReturnValue(new Promise(() => {}));
    const { gate, wrapper } = setup();
    expect(gate.visible.value).toBe(true);
    wrapper.unmount();
  });

  it("hides packs and writes the org flag once the org passes both counts", async () => {
    vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({
      data: summary(12, 15),
    } as never);
    vi.spyOn(kv, "get").mockRejectedValue(notFound());
    const set = vi.spyOn(kv, "set").mockResolvedValue({ data: "" } as never);
    const { gate, wrapper } = setup();
    await flushPromises();
    expect(gate.visible.value).toBe(false);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith("org1", PACKS_RETIRED_KEY, "1");
    wrapper.unmount();
  });

  it("does not write the flag again when the read answers after the counts", async () => {
    vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({
      data: summary(30, 30),
    } as never);
    let answer!: (value: unknown) => void;
    vi.spyOn(kv, "get").mockReturnValue(new Promise((done) => (answer = done)) as never);
    const set = vi.spyOn(kv, "set").mockResolvedValue({ data: "" } as never);
    const { gate, wrapper } = setup();
    await flushPromises();
    expect(gate.visible.value).toBe(false);
    expect(set).not.toHaveBeenCalled();
    answer({ data: "1" });
    await flushPromises();
    expect(set).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("keeps packs hidden from the flag after the counts drop", async () => {
    vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({
      data: summary(1, 1),
    } as never);
    const get = vi.spyOn(kv, "get").mockResolvedValue({ data: "1" } as never);
    const set = vi.spyOn(kv, "set");
    const { gate, wrapper } = setup();
    await flushPromises();
    expect(get).toHaveBeenCalledWith("org1", PACKS_RETIRED_KEY);
    expect(gate.visible.value).toBe(false);
    expect(set).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("still hides packs from the counts for a user who cannot write the flag", async () => {
    vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({
      data: summary(20, 20),
    } as never);
    vi.spyOn(kv, "get").mockRejectedValue(notFound());
    const set = vi.spyOn(kv, "set").mockRejectedValue(new Error("403"));
    const { gate, wrapper } = setup();
    await flushPromises();
    expect(set).toHaveBeenCalledTimes(1);
    expect(gate.visible.value).toBe(false);
    wrapper.unmount();
  });

  it("keeps showing packs when the counts and the flag fail to load", async () => {
    queryClient.setDefaultOptions({ queries: { retry: false } });
    vi.spyOn(organizations, "get_organization_summary").mockRejectedValue(new Error("down"));
    vi.spyOn(kv, "get").mockRejectedValue(new Error("down"));
    const set = vi.spyOn(kv, "set");
    const { gate, wrapper } = setup();
    await flushPromises();
    expect(gate.visible.value).toBe(true);
    expect(set).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
