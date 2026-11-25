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
import { defineComponent, h, nextTick, ref } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import alerts from "@/services/alerts";
import dashboards from "@/services/dashboards";
import http from "@/services/http";
import kv from "@/services/kv";
import organizations from "@/services/organizations";
import { createdOrgs, refreshOrgSummarySoon } from "@/services/orgSummaryRefresh";
import { orgSummaryQuery } from "@/services/organizations.queries";
import store from "@/stores";
import { refreshOrgResources } from "@/composables/useOrgResources";

vi.mock("@/services/http", () => ({ default: vi.fn() }));

import {
  PACKS_RETIRED_KEY,
  forgetPackGate,
  packsRetired,
  resetPackGate,
  usePackGate,
} from "./usePackGate";

const summary = (alerts: number, dashboards: number) => ({
  alerts: { num_realtime: 0, num_scheduled: alerts },
  total_dashboards: dashboards,
});

const noFlag = () => ({ data: [] });
const flagSet = () => ({ data: [PACKS_RETIRED_KEY] });

function setup(enabled?: () => boolean, askAgain?: () => boolean) {
  let gate!: ReturnType<typeof usePackGate>;
  const wrapper = mount(
    defineComponent({
      setup() {
        gate = usePackGate("org1", enabled, askAgain);
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

  it("hides packs while the counts or the flag are still loading", async () => {
    vi.spyOn(organizations, "get_organization_summary").mockReturnValue(new Promise(() => {}));
    vi.spyOn(kv, "list").mockResolvedValue(noFlag() as never);
    const { gate, wrapper } = setup();
    expect(gate.visible.value).toBe(false);
    await flushPromises();
    expect(gate.visible.value).toBe(false);
    wrapper.unmount();
  });

  it("hides packs while the flag is still loading for a small org", async () => {
    vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({
      data: summary(1, 1),
    } as never);
    vi.spyOn(kv, "list").mockReturnValue(new Promise(() => {}));
    const { gate, wrapper } = setup();
    await flushPromises();
    expect(gate.visible.value).toBe(false);
    wrapper.unmount();
  });

  it("shows packs once a small org's counts and flag have answered", async () => {
    vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({
      data: summary(1, 1),
    } as never);
    vi.spyOn(kv, "list").mockResolvedValue(noFlag() as never);
    const { gate, wrapper } = setup();
    await flushPromises();
    expect(gate.visible.value).toBe(true);
    wrapper.unmount();
  });

  it.each([
    [
      "a dashboard",
      () => dashboards.create("org1", {}, "default"),
      summary(11, 10),
      summary(11, 11),
    ],
    [
      "an alert",
      () => alerts.create_by_alert_id("org1", {}, "default"),
      summary(10, 11),
      summary(11, 11),
    ],
  ])(
    "hides packs as soon as creating %s takes the org past both counts",
    async (_n, create, before, after) => {
      vi.mocked(http).mockReturnValue({ post: vi.fn().mockResolvedValue({ data: {} }) } as never);
      vi.spyOn(organizations, "get_organization_summary")
        .mockResolvedValueOnce({ data: before } as never)
        .mockResolvedValue({ data: after } as never);
      vi.spyOn(kv, "list").mockResolvedValue(noFlag() as never);
      vi.spyOn(kv, "set").mockResolvedValue({ data: "" } as never);
      const { gate, wrapper } = setup();
      await flushPromises();
      expect(gate.visible.value).toBe(true);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await create();
      vi.advanceTimersByTime(1_000);
      vi.useRealTimers();
      await flushPromises();
      expect(gate.visible.value).toBe(false);
      wrapper.unmount();
    },
  );

  it("hides packs and writes the org flag once the org passes both counts", async () => {
    vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({
      data: summary(12, 15),
    } as never);
    vi.spyOn(kv, "list").mockResolvedValue(noFlag() as never);
    const set = vi.spyOn(kv, "set").mockResolvedValue({ data: "" } as never);
    const { gate, wrapper } = setup();
    await flushPromises();
    expect(gate.visible.value).toBe(false);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith("org1", PACKS_RETIRED_KEY, "1", { silentForbidden: true });
    wrapper.unmount();
  });

  it("does not write the flag again when the read answers after the counts", async () => {
    vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({
      data: summary(30, 30),
    } as never);
    let answer!: (value: unknown) => void;
    vi.spyOn(kv, "list").mockReturnValue(new Promise((done) => (answer = done)) as never);
    const set = vi.spyOn(kv, "set").mockResolvedValue({ data: "" } as never);
    const { gate, wrapper } = setup();
    await flushPromises();
    expect(gate.visible.value).toBe(false);
    expect(set).not.toHaveBeenCalled();
    answer(flagSet());
    await flushPromises();
    expect(set).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("keeps packs hidden from the flag after the counts drop", async () => {
    vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({
      data: summary(1, 1),
    } as never);
    const list = vi.spyOn(kv, "list").mockResolvedValue(flagSet() as never);
    const set = vi.spyOn(kv, "set");
    const { gate, wrapper } = setup();
    await flushPromises();
    expect(list).toHaveBeenCalledWith("org1", PACKS_RETIRED_KEY);
    expect(gate.visible.value).toBe(false);
    expect(set).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("still hides packs from the counts for a user who cannot write the flag", async () => {
    vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({
      data: summary(20, 20),
    } as never);
    vi.spyOn(kv, "list").mockResolvedValue(noFlag() as never);
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
    vi.spyOn(kv, "list").mockRejectedValue(new Error("down"));
    const set = vi.spyOn(kv, "set");
    const { gate, wrapper } = setup();
    await flushPromises();
    expect(gate.visible.value).toBe(true);
    expect(set).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("reads a missing flag from the key list as not retired, without a single-key read", async () => {
    vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({
      data: summary(1, 1),
    } as never);
    const list = vi.spyOn(kv, "list").mockResolvedValue(noFlag() as never);
    const get = vi.spyOn(kv, "get");
    const { gate, wrapper } = setup();
    await flushPromises();
    expect(list).toHaveBeenCalledWith("org1", PACKS_RETIRED_KEY);
    expect(get).not.toHaveBeenCalled();
    expect(gate.visible.value).toBe(true);
    expect(gate.retired.value).toBe(false);
    wrapper.unmount();
  });

  it("does not count a longer key the prefix list also returns", async () => {
    vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({
      data: summary(1, 1),
    } as never);
    vi.spyOn(kv, "list").mockResolvedValue({
      data: [`${PACKS_RETIRED_KEY}_old`, "starter_pack_retiredX"],
    } as never);
    vi.spyOn(kv, "set").mockResolvedValue({ data: "" } as never);
    const { gate, wrapper } = setup();
    await flushPromises();
    expect(gate.visible.value).toBe(true);
    expect(gate.retired.value).toBe(false);
    wrapper.unmount();
  });

  it("makes no request while disabled, then reads once enabled", async () => {
    const counts = vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({
      data: summary(1, 1),
    } as never);
    const list = vi.spyOn(kv, "list").mockResolvedValue(noFlag() as never);
    const on = ref(false);
    const { gate, wrapper } = setup(() => on.value);
    await flushPromises();
    expect(counts).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(gate.visible.value).toBe(false);
    on.value = true;
    await flushPromises();
    expect(counts).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
    expect(gate.visible.value).toBe(true);
    wrapper.unmount();
  });

  describe("a surface that trusts the session's answer", () => {
    const ME = "me@x.io";
    const KEY = `o2.starterPacks.gate.org1.${ME}`;
    const quiet = (askAgain = () => false) => setup(() => true, askAgain);
    const answers = (counts: unknown, flag = noFlag()) => {
      vi.spyOn(kv, "set").mockResolvedValue({ data: "" } as never);
      vi.spyOn(kv, "list").mockResolvedValue(flag as never);
      return vi
        .spyOn(organizations, "get_organization_summary")
        .mockResolvedValue({ data: counts } as never);
    };
    const reload = () => {
      queryClient.clear();
      resetPackGate();
    };
    // A first load that got the answer "not retired", then a reload of the page.
    const openSession = async () => {
      const counts = answers(summary(1, 1));
      const first = quiet();
      await flushPromises();
      first.wrapper.unmount();
      reload();
      counts.mockClear();
      vi.mocked(kv.list).mockClear();
      return counts;
    };

    beforeEach(() => {
      window.sessionStorage.clear();
      createdOrgs.clear();
      store.commit("setUserInfo", { email: ME });
    });
    afterEach(() => store.commit("setUserInfo", {}));

    it("asks on the first load of the session, then stays visible and quiet", async () => {
      const counts = answers(summary(1, 1));
      const first = quiet();
      expect(first.gate.visible.value).toBe(false);
      await flushPromises();
      expect(counts).toHaveBeenCalledTimes(1);
      expect(first.gate.visible.value).toBe(true);
      expect(window.sessionStorage.getItem(KEY)).not.toBeNull();
      first.wrapper.unmount();
      reload();
      const second = quiet();
      expect(second.gate.visible.value).toBe(true);
      await flushPromises();
      expect(counts).toHaveBeenCalledTimes(1);
      expect(kv.list).toHaveBeenCalledTimes(1);
      second.wrapper.unmount();
    });

    it("asks again without hiding first once it is told to", async () => {
      const counts = await openSession();
      const ask = ref(false);
      const { gate, wrapper } = quiet(() => ask.value);
      ask.value = true;
      await nextTick();
      expect(gate.visible.value).toBe(true);
      await flushPromises();
      expect(counts).toHaveBeenCalledTimes(1);
      expect(gate.visible.value).toBe(true);
      wrapper.unmount();
    });

    it("asks nothing for a surface that would not show", async () => {
      const counts = answers(summary(1, 1));
      const { wrapper } = setup(
        () => false,
        () => false,
      );
      await flushPromises();
      expect(counts).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it("follows the counts another surface read, and again when they cross later", async () => {
      const counts = await openSession();
      const { gate, wrapper } = quiet();
      await queryClient.fetchQuery(orgSummaryQuery("org1"));
      await flushPromises();
      expect(gate.retired.value).toBe(false);
      counts.mockResolvedValue({ data: summary(11, 11) } as never);
      await refreshOrgResources("org1");
      await flushPromises();
      expect(counts).toHaveBeenCalledTimes(2);
      expect(gate.visible.value).toBe(false);
      expect(window.sessionStorage.getItem(KEY)).toBeNull();
      wrapper.unmount();
    });

    it("asks again once this page created something counted in its org only", async () => {
      const counts = await openSession();
      counts.mockResolvedValue({ data: summary(11, 11) } as never);
      const { gate, wrapper } = quiet();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      refreshOrgSummarySoon("other");
      vi.advanceTimersByTime(1_000);
      await nextTick();
      expect(counts).not.toHaveBeenCalled();
      refreshOrgSummarySoon("org1");
      vi.advanceTimersByTime(1_000);
      vi.useRealTimers();
      await flushPromises();
      expect(counts).toHaveBeenCalledTimes(1);
      expect(gate.visible.value).toBe(false);
      wrapper.unmount();
    });

    it("keeps no answer for a retired org, a failed read or another user", async () => {
      answers(summary(1, 1), flagSet());
      const retired = quiet();
      await flushPromises();
      expect(window.sessionStorage.length).toBe(0);
      retired.wrapper.unmount();

      reload();
      queryClient.setDefaultOptions({ queries: { retry: false } });
      vi.mocked(kv.list).mockRejectedValue(new Error("down"));
      const failed = quiet();
      await flushPromises();
      expect(failed.gate.visible.value).toBe(true);
      expect(window.sessionStorage.length).toBe(0);
      failed.wrapper.unmount();

      reload();
      const counts = await openSession();
      store.commit("setUserInfo", { email: "other@x.io" });
      const other = quiet();
      expect(other.gate.visible.value).toBe(false);
      await flushPromises();
      expect(counts).toHaveBeenCalledTimes(1);
      other.wrapper.unmount();
    });

    it("asks again on the next load once the answer is forgotten", async () => {
      const counts = await openSession();
      forgetPackGate("org1");
      const { gate, wrapper } = quiet();
      expect(gate.visible.value).toBe(false);
      await flushPromises();
      expect(counts).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });

    it("works with no session storage", async () => {
      const counts = answers(summary(1, 1));
      const blocked = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
        throw new Error("blocked");
      });
      const { gate, wrapper } = quiet();
      await flushPromises();
      expect(() => forgetPackGate("org1")).not.toThrow();
      blocked.mockRestore();
      expect(counts).toHaveBeenCalledTimes(1);
      expect(gate.visible.value).toBe(true);
      wrapper.unmount();
    });

    it("is not trusted by a surface that always asks", async () => {
      await openSession();
      const { gate, wrapper } = setup();
      expect(gate.visible.value).toBe(false);
      await flushPromises();
      expect(gate.visible.value).toBe(true);
      wrapper.unmount();
    });
  });

  it("answers retired from the flag or the counts, never from a failed read", async () => {
    vi.spyOn(organizations, "get_organization_summary").mockResolvedValue({
      data: summary(1, 1),
    } as never);
    vi.spyOn(kv, "list").mockResolvedValue(flagSet() as never);
    const flagged = setup();
    await flushPromises();
    expect(flagged.gate.retired.value).toBe(true);
    flagged.wrapper.unmount();

    queryClient.clear();
    queryClient.setDefaultOptions({ queries: { retry: false } });
    vi.spyOn(organizations, "get_organization_summary").mockRejectedValue(new Error("down"));
    vi.spyOn(kv, "list").mockRejectedValue(new Error("down"));
    const failed = setup();
    await flushPromises();
    expect(failed.gate.retired.value).toBe(false);
    failed.wrapper.unmount();
  });
});
