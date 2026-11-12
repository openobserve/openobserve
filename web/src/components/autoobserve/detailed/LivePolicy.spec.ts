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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import { queryClient } from "@/composables/query/queryClient";
import slack from "@/services/slack";
import AutoObserveSettingsReach from "../AutoObserveSettingsReach.vue";
import LivePolicy from "./LivePolicy.vue";

const routeQuery = reactive<Record<string, string | undefined>>({});
const push = vi.fn();
const replace = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRoute: () => ({ query: routeQuery }),
  useRouter: () => ({ push, replace }),
}));
vi.mock("@/services/slack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/slack")>();
  return { ...actual, default: { ...actual.default, getInsightsSettings: vi.fn() } };
});

const settingsApi = vi.mocked(slack.getInsightsSettings);
const httpError = (status: number) => ({
  response: { status, data: { message: "raw server text" } },
});

let wrapper: VueWrapper | null = null;
const mountIt = async (comp: unknown) => {
  wrapper = mount(comp as never, {
    global: {
      plugins: [i18n, store, withQueryClient(queryClient)],
      stubs: { AutoObserveSettingsPaging: true },
    },
  });
  await flushPromises();
  return wrapper;
};
const sel = (w: VueWrapper, test: string) => w.find(`[data-test="${test}"]`);

beforeEach(() => {
  queryClient.clear();
  for (const key of Object.keys(routeQuery)) delete routeQuery[key];
  push.mockReset();
  replace.mockReset();
  settingsApi.mockReset();
  store.state.selectedOrganization.identifier = "demo-org";
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("Where should I reach you (settings-drawer)", () => {
  it("holds two skeleton lines while the Slack settings load", async () => {
    settingsApi.mockReturnValue(new Promise(() => undefined) as never);
    const w = await mountIt(AutoObserveSettingsReach);
    expect(w.findAll('[data-test="autoobserve-settings-reach"] .h-4')).toHaveLength(2);
    expect(sel(w, "autoobserve-settings-reach-error").exists()).toBe(false);
  });

  it("names the channel and the digest time, with a way to change it", async () => {
    settingsApi.mockResolvedValue({
      data: { channel: { channel_name: "oncall-eu" }, digest_time: "09:00" },
    } as never);
    const w = await mountIt(AutoObserveSettingsReach);
    expect(sel(w, "autoobserve-settings-reach-channel").text()).toBe(
      "Slack: #oncall-eu, with a daily summary at 09:00.",
    );
    await sel(w, "autoobserve-settings-reach-open").trigger("click");
    expect(push).toHaveBeenCalledWith({ name: "slack", query: { org_identifier: "demo-org" } });
    expect(sel(w, "autoobserve-settings-reach-open").text()).toBe("Change in Slack settings");
  });

  it("with no channel picked yet, says where it reaches you instead", async () => {
    settingsApi.mockResolvedValue({ data: { channel: null, digest_time: null } } as never);
    const w = await mountIt(AutoObserveSettingsReach);
    expect(sel(w, "autoobserve-settings-reach-none").text()).toContain(
      "No Slack channel is picked yet",
    );
    expect(sel(w, "autoobserve-settings-reach-open").text()).toBe("Set up Slack");
  });

  it("a 404 is Slack not set up, neutral, with Set up Slack", async () => {
    settingsApi.mockRejectedValue(httpError(404));
    const w = await mountIt(AutoObserveSettingsReach);
    const line = sel(w, "autoobserve-settings-reach-error");
    expect(line.attributes("data-failure")).toBe("off");
    expect(line.classes()).toContain("text-text-secondary");
    expect(line.text()).toBe("Slack isn't set up for this organization.");
    expect(sel(w, "autoobserve-settings-reach-open").text()).toBe("Set up Slack");
  });

  it("a 403 is red, says what is missing, and offers nothing it can't open", async () => {
    settingsApi.mockRejectedValue(httpError(403));
    const w = await mountIt(AutoObserveSettingsReach);
    const line = sel(w, "autoobserve-settings-reach-error");
    expect(line.attributes("data-failure")).toBe("denied");
    expect(line.classes()).toContain("text-status-error-text");
    expect(line.text()).toBe("You don't have permission to see the Slack settings.");
    expect(sel(w, "autoobserve-settings-reach-open").exists()).toBe(false);
    expect(w.text()).not.toContain("raw server text");
  });

  it("a 500 says it failed and retries in place", async () => {
    settingsApi.mockRejectedValueOnce(httpError(500));
    const w = await mountIt(AutoObserveSettingsReach);
    expect(sel(w, "autoobserve-settings-reach-error").text()).toBe(
      "Couldn't load the Slack settings.",
    );
    settingsApi.mockResolvedValueOnce({
      data: { channel: { channel_name: "ops" }, digest_time: "08:30" },
    } as never);
    await sel(w, "autoobserve-settings-reach-retry").trigger("click");
    await flushPromises();
    expect(sel(w, "autoobserve-settings-reach-channel").text()).toContain("#ops");
    expect(settingsApi).toHaveBeenCalledTimes(2);
  });
});

describe("Policy (detailed-policy)", () => {
  it("opens on Coverage, and each section lives in the URL", async () => {
    const w = await mountIt(LivePolicy);
    expect(sel(w, "autoobserve-policy-section-coverage").exists()).toBe(true);
    expect(sel(w, "autoobserve-policy-nav-coverage").attributes("aria-current")).toBe("page");
    await sel(w, "autoobserve-policy-nav-channels").trigger("click");
    expect(replace).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ section: "channels" }),
    });
    routeQuery.section = "channels";
    await flushPromises();
    expect(sel(w, "autoobserve-policy-section-channels").exists()).toBe(true);
    expect(settingsApi).toHaveBeenCalledTimes(1);
  });

  it("reads the Slack settings only when Channels opens", async () => {
    routeQuery.section = "alerts";
    await mountIt(LivePolicy);
    expect(settingsApi).not.toHaveBeenCalled();
  });

  it("shows each mode it has, disabled, with one reason line for the lot", async () => {
    for (const section of ["coverage", "alerts"]) {
      routeQuery.section = section;
      const w = await mountIt(LivePolicy);
      const groups = w.findAllComponents({ name: "OToggleGroup" });
      expect(groups.length, section).toBeGreaterThan(0);
      expect(groups.every((g) => g.props("disabled") === true)).toBe(true);
      expect(w.findAll('[data-test="autoobserve-policy-modes-reason"]')).toHaveLength(1);
      expect(sel(w, "autoobserve-policy-modes-reason").text()).toContain("waits for your OK");
      w.unmount();
    }
  });

  it("Investigation says whether AI analysis runs, and Channels links on-call routing", async () => {
    routeQuery.section = "investigation";
    store.state.zoConfig = { ...store.state.zoConfig, incidents_rca_enabled: false };
    const w = await mountIt(LivePolicy);
    expect(sel(w, "autoobserve-policy-rca").text()).toContain("AI analysis is off");
    w.unmount();
    routeQuery.section = "channels";
    settingsApi.mockResolvedValue({ data: { channel: null } } as never);
    const channels = await mountIt(LivePolicy);
    await sel(channels, "autoobserve-policy-oncall").trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "onCallRouting",
      query: { org_identifier: "demo-org" },
    });
  });

  it("an unknown section falls back to Coverage", async () => {
    routeQuery.section = "fixes";
    const w = await mountIt(LivePolicy);
    expect(sel(w, "autoobserve-policy-section-coverage").exists()).toBe(true);
    expect(sel(w, "autoobserve-policy-nav-fixes").exists()).toBe(false);
  });
});
