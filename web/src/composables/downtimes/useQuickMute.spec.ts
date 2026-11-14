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
import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import downtimes from "@/services/downtimes";
import common from "@/services/common";
import { queryClient } from "@/composables/query/queryClient";
import { useQuickMute } from "./useQuickMute";

const toast = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
const serverNow = vi.hoisted(() => ({ ms: 0 }));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/services/downtimes", () => ({ default: { create: vi.fn() } }));
vi.mock("@/services/common", () => ({ default: { list_Folders: vi.fn() } }));
vi.mock("@/composables/useAnnouncementBanners", () => ({ serverNowMs: () => serverNow.ms }));

const SERVER_NOW = Date.parse("2026-09-17T10:00:00Z");

const run = async () => {
  let api!: ReturnType<typeof useQuickMute>;
  const Host = defineComponent({
    setup() {
      api = useQuickMute();
      return () => null;
    },
  });
  const store = createStore({
    state: {
      timezone: "UTC",
      selectedOrganization: { identifier: "acme" },
      zoConfig: { downtimes_enabled: true },
    },
  });
  const wrapper = mount(Host, { global: { plugins: [store] } });
  await flushPromises();
  return { api, wrapper, store };
};

describe("useQuickMute", () => {
  beforeEach(() => {
    queryClient.clear();
    toast.mockClear();
    push.mockClear();
    serverNow.ms = SERVER_NOW;
    vi.mocked(common.list_Folders).mockResolvedValue({
      data: { list: [{ folderId: "f-ops", name: "Ops maintenance" }] },
    } as never);
    vi.mocked(downtimes.create).mockReset();
    vi.mocked(downtimes.create).mockResolvedValue({ data: { id: "d9" } } as never);
  });
  afterEach(() => vi.useRealTimers());

  it("starts at the server time, so a fast client clock does not shorten the mute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SERVER_NOW + 3 * 60_000);
    const { api, wrapper } = await run();
    await api.muteFor([{ module: "alerts", ids: ["a1"] }], 3600);
    const body = vi.mocked(downtimes.create).mock.calls[0][1];
    expect(body.schedule.starts_at).toBe(SERVER_NOW * 1000);
    expect(body.schedule.ends_at).toBe((SERVER_NOW + 3_600_000) * 1000);
    wrapper.unmount();
  });

  it("names the day of a mute that ends after tomorrow and the folder by its name, and links in the folder", async () => {
    const { api, wrapper } = await run();
    await api.mute([{ module: "alerts", ids: ["a1"] }], (SERVER_NOW + 50 * 3_600_000) * 1000);
    const [{ message, action }] = toast.mock.calls[0];
    expect(String(message)).toContain("Ops maintenance");
    expect(String(message)).not.toContain("f-ops");
    expect(String(message)).toMatch(/Sep 19, 2026|19 Sep/);
    action.handler();
    expect(push).toHaveBeenCalledWith({
      name: "downtimeDetail",
      params: { id: "d9" },
      query: { org_identifier: "acme", folder: "f-ops" },
    });
    wrapper.unmount();
  });

  it("keeps the bare time for a mute that ends today and says tomorrow for one that ends tomorrow", async () => {
    const { api, wrapper } = await run();
    await api.mute([{ module: "alerts", ids: ["a1"] }], (SERVER_NOW + 2 * 3_600_000) * 1000);
    expect(String(toast.mock.calls[0][0].message)).toContain("12:00 UTC");
    await api.mute([{ module: "alerts", ids: ["a1"] }], (SERVER_NOW + 20 * 3_600_000) * 1000);
    expect(String(toast.mock.calls[1][0].message)).toContain("06:00 tomorrow");
    wrapper.unmount();
  });

  it("links the View downtime toast to the folder and org the mute was filed in", async () => {
    const { api, wrapper, store } = await run();
    const id = await api.mute(
      [{ module: "anomaly_detections", ids: ["x1"] }],
      (SERVER_NOW + 3_600_000) * 1000,
      undefined,
      "ops",
    );
    expect(id).toBe("d9");
    // The org changes before the click: the link still names the org the mute is in.
    store.state.selectedOrganization.identifier = "other";
    toast.mock.calls.at(-1)?.[0].action?.handler();
    expect(push).toHaveBeenCalledWith({
      name: "downtimeDetail",
      params: { id: "d9" },
      query: { org_identifier: "acme", folder: "ops" },
    });
    wrapper.unmount();
  });
});
