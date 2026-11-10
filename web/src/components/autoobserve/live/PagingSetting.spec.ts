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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import autoobserve from "@/services/autoobserve";
import config from "@/aws-exports";
import PagingSetting from "./PagingSetting.vue";
import LiveSettingsPanel from "./LiveSettingsPanel.vue";
import AutoObservePolicyTab from "../AutoObservePolicyTab.vue";

const push = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push }),
}));

vi.mock("@/services/autoobserve", () => ({
  default: {
    coverage: vi.fn(),
    suggestions: vi.fn(),
    incidents: vi.fn(),
    pagingSettings: vi.fn(),
    setPagingSettings: vi.fn(),
  },
}));

const get = vi.mocked(autoobserve.pagingSettings);
const put = vi.mocked(autoobserve.setPagingSettings);

const ok = (page_on_stop: boolean, available = true) =>
  ({ data: { page_on_stop, available } }) as never;
const httpError = (status: number, data: unknown = {}) => ({ response: { status, data } });

const originalOrg = store.state.selectedOrganization;
const originalBuild = config.isEnterprise;

let wrappers: { unmount: () => void }[] = [];
const mountIt = <T>(component: T) => {
  const wrapper = mount(component as never, {
    attachTo: document.body,
    global: { plugins: [i18n, store] },
  });
  wrappers.push(wrapper);
  return wrapper;
};

const sel = (name: string) => `[data-test="autoobserve-paging${name ? `-${name}` : ""}"]`;
const switchOf = (w: ReturnType<typeof mountIt>) => w.find(`${sel("switch")} button`);

describe("PagingSetting (W1)", () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
    push.mockReset();
    queryClient.clear();
    config.isEnterprise = "true";
    store.commit("setSelectedOrganization", { ...originalOrg, identifier: "demo-org" });
  });

  afterEach(() => {
    for (const w of wrappers) w.unmount();
    wrappers = [];
    config.isEnterprise = originalBuild;
    store.commit("setSelectedOrganization", originalOrg);
  });

  it("off: the switch is off and says where pages go", async () => {
    get.mockResolvedValue(ok(false));
    const w = mountIt(PagingSetting);
    await flushPromises();
    expect(w.text()).toContain("Page on-call when a stream stops");
    expect(w.text()).toContain("on-call team that owns the service");
    expect(w.text()).toContain("default team");
    expect(switchOf(w).attributes("aria-checked")).toBe("false");
    expect(switchOf(w).attributes("disabled")).toBeUndefined();
    expect(w.find(sel("status")).text()).toBe("");
  });

  it("on: reads the server's value", async () => {
    get.mockResolvedValue(ok(true));
    const w = mountIt(PagingSetting);
    await flushPromises();
    expect(switchOf(w).attributes("aria-checked")).toBe("true");
  });

  it("unavailable: disabled with the neutral deployment line", async () => {
    get.mockResolvedValue(ok(false, false));
    const w = mountIt(PagingSetting);
    await flushPromises();
    expect(switchOf(w).attributes("disabled")).toBeDefined();
    const status = w.find(sel("status"));
    expect(status.text()).toBe("Paging is turned off for this deployment.");
    expect(status.classes().join(" ")).not.toMatch(/error|warning/);
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it("unavailable while the org's value is on: the switch is drawn off, since nothing pages", async () => {
    get.mockResolvedValue(ok(true, false));
    const w = mountIt(PagingSetting);
    await flushPromises();
    expect(switchOf(w).attributes("aria-checked")).toBe("false");
    expect(switchOf(w).attributes("disabled")).toBeDefined();
  });

  it("turning it on PUTs the value, is busy meanwhile, then holds the server's value", async () => {
    get.mockResolvedValue(ok(false));
    let resolve: (v: unknown) => void = () => {};
    put.mockReturnValue(new Promise((r) => (resolve = r)) as never);
    const w = mountIt(PagingSetting);
    await flushPromises();
    await switchOf(w).trigger("click");
    expect(put).toHaveBeenCalledWith("demo-org", { page_on_stop: true });
    expect(switchOf(w).attributes("aria-busy")).toBe("true");
    expect(switchOf(w).attributes("disabled")).toBeDefined();
    resolve(ok(true));
    await flushPromises();
    expect(switchOf(w).attributes("aria-checked")).toBe("true");
    expect(switchOf(w).attributes("disabled")).toBeUndefined();
  });

  it("PUT 403: the shared red denial, and the switch returns to off", async () => {
    get.mockResolvedValue(ok(false));
    put.mockRejectedValue(httpError(403));
    const w = mountIt(PagingSetting);
    await flushPromises();
    await switchOf(w).trigger("click");
    await flushPromises();
    const status = w.find(sel("status"));
    expect(status.text()).toBe(
      "You don't have permission to change this. Ask your administrator for access.",
    );
    expect(status.attributes("role")).toBe("alert");
    expect(status.classes().join(" ")).toContain("error");
    expect(switchOf(w).attributes("aria-checked")).toBe("false");
  });

  it("the status row holds two lines from first paint, so a wrapped message moves nothing below", async () => {
    get.mockResolvedValue(ok(false));
    const w = mountIt(PagingSetting);
    await flushPromises();
    const status = w.find(sel("status"));
    expect(status.text()).toBe("");
    expect(status.classes()).toContain("min-h-8");
  });

  it("PUT 409 paging_unavailable: the switch locks with the deployment line", async () => {
    get.mockResolvedValue(ok(false));
    put.mockRejectedValue(httpError(409, { error: "paging_unavailable" }));
    const w = mountIt(PagingSetting);
    await flushPromises();
    await switchOf(w).trigger("click");
    await flushPromises();
    expect(switchOf(w).attributes("disabled")).toBeDefined();
    expect(switchOf(w).attributes("aria-checked")).toBe("false");
    expect(w.find(sel("status")).text()).toBe("Paging is turned off for this deployment.");
  });

  it("any other PUT failure is the shared red failure", async () => {
    get.mockResolvedValue(ok(true));
    put.mockRejectedValue(httpError(500));
    const w = mountIt(PagingSetting);
    await flushPromises();
    await switchOf(w).trigger("click");
    await flushPromises();
    expect(w.find(sel("status")).text()).toBe("This couldn't be saved. Try again.");
    expect(switchOf(w).attributes("aria-checked")).toBe("true");
  });

  it("On-call routing opens the routing page in this org", async () => {
    get.mockResolvedValue(ok(false));
    const w = mountIt(PagingSetting);
    await flushPromises();
    await w.find(sel("routing")).trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "onCallRouting",
      query: { org_identifier: "demo-org" },
    });
  });

  describe("live settings panel", () => {
    it("shows the switch and the one neutral line for controls that do not exist yet", async () => {
      get.mockResolvedValue(ok(false));
      const w = mountIt(LiveSettingsPanel);
      await flushPromises();
      expect(w.find(sel("")).exists()).toBe(true);
      expect(w.find('[data-test="autoobserve-live-settings-later"]').text()).toContain(
        "will be set here once those controls exist",
      );
      expect(w.find('[data-test="autoobserve-live-empty-settings"]').exists()).toBe(false);
    });

    it("in the Detailed Policy tab, a denial spans the panel like the Issues denial (T1-N8)", async () => {
      get.mockRejectedValue(httpError(403));
      const wrapper = mount(LiveSettingsPanel, {
        props: { inPage: true },
        attachTo: document.body,
        global: { plugins: [i18n, store] },
      });
      wrappers.push(wrapper);
      await flushPromises();
      const notice = wrapper.get('[data-test="autoobserve-live-settings-paging-notice"]');
      expect(notice.classes()).not.toContain("max-w-2xl");
    });

    it("a server without the route keeps today's empty state", async () => {
      get.mockRejectedValue(httpError(404));
      const w = mountIt(LiveSettingsPanel);
      await flushPromises();
      expect(w.find(sel("")).exists()).toBe(false);
      expect(w.find('[data-test="autoobserve-live-empty-settings"]').exists()).toBe(true);
    });

    const settle = async () => {
      for (let i = 0; i < 20; i++) {
        await flushPromises();
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    // After the cap the mock never settles, so a refetch loop ends with a count instead of hanging the run.
    const failFor = (status: number, cap = 40) => {
      let calls = 0;
      get.mockImplementation(() =>
        calls++ < cap ? Promise.reject(httpError(status)) : (new Promise(() => {}) as never),
      );
    };

    it("GET 403: one request, then a red denial instead of a blank panel", async () => {
      failFor(403);
      const w = mountIt(LiveSettingsPanel);
      await settle();
      expect(get).toHaveBeenCalledTimes(1);
      const notice = w.find('[data-test="autoobserve-live-settings-paging-notice"]');
      expect(notice.exists()).toBe(true);
      expect(notice.text()).toContain("You don't have permission to see the paging setting");
      expect(notice.attributes("role")).toBe("alert");
      expect(w.text()).not.toContain("Retry");
      expect(w.find(sel("")).exists()).toBe(false);
    });

    it("GET 500: one request, a red failure with Retry, and Retry reads once more", async () => {
      failFor(500);
      const w = mountIt(LiveSettingsPanel);
      await settle();
      expect(get).toHaveBeenCalledTimes(1);
      const notice = w.find('[data-test="autoobserve-live-settings-paging-notice"]');
      expect(notice.text()).toContain("Couldn't load the paging setting");
      get.mockResolvedValue(ok(true));
      await w.find('[data-test="autoobserve-live-settings-paging-retry"]').trigger("click");
      await settle();
      expect(get).toHaveBeenCalledTimes(2);
      expect(switchOf(w).attributes("aria-checked")).toBe("true");
    });

    it("an OSS build never asks for the route and keeps today's empty state", async () => {
      config.isEnterprise = "false";
      const w = mountIt(LiveSettingsPanel);
      await flushPromises();
      expect(get).not.toHaveBeenCalled();
      expect(w.find('[data-test="autoobserve-live-empty-settings"]').exists()).toBe(true);
    });
  });

  describe("sample Policy tab", () => {
    it("puts the switch at the top of its Paging section", async () => {
      get.mockResolvedValue(ok(true));
      const w = mountIt(AutoObservePolicyTab);
      await flushPromises();
      const section = w.find('[data-test="autoobserve-policy-paging"]');
      expect(section.find(sel("")).exists()).toBe(true);
      expect(section.text()).toContain("Severity decides how a problem reaches people.");
    });

    it("keeps the section as today when the server has no route", async () => {
      get.mockRejectedValue(httpError(404));
      const w = mountIt(AutoObservePolicyTab);
      await flushPromises();
      expect(w.find(sel("")).exists()).toBe(false);
    });
  });
});
