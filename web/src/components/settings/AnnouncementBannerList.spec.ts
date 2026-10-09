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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

installQuasar();

const getConfig = vi.fn();
const setConfig = vi.fn();
const notify = vi.fn();
const push = vi.fn();

vi.mock("@/services/announcements", () => ({
  default: {
    getConfig: (...args: unknown[]) => getConfig(...args),
    setConfig: (...args: unknown[]) => setConfig(...args),
  },
}));

vi.mock("quasar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("quasar")>()),
  useQuasar: () => ({ notify }),
}));

vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      theme: "light",
      zoConfig: { meta_org: "_meta" },
      selectedOrganization: { identifier: "_meta" },
    },
  }),
}));

import AnnouncementBannerList from "./AnnouncementBannerList.vue";

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const HOUR = 3_600_000;

const STORED = {
  banners: [
    { message: "Webinar **today**", variant: "promo" },
    { message: "Outage", variant: "critical", orgs: ["a", "b"] },
    { message: "Later", starts_at: iso(2 * HOUR), ends_at: iso(3 * HOUR) },
    {
      message: "Over",
      ends_at: iso(-HOUR),
      colors: { light: "#DBEAFE", dark: "#1E3A8A" },
    },
    {
      message: "Window",
      starts_at: iso(-HOUR),
      ends_at: iso(HOUR),
      text_size: "small",
    },
  ],
};

async function mountList() {
  const wrapper = mount(AnnouncementBannerList, {
    global: { plugins: [i18n], stubs: { ConfirmDialog: true } },
  });
  await flushPromises();
  return wrapper;
}

describe("AnnouncementBannerList", () => {
  beforeEach(() => {
    getConfig.mockResolvedValue({ data: structuredClone(STORED) });
    setConfig.mockResolvedValue({ data: {} });
  });

  afterEach(() => vi.clearAllMocks());

  it("computes each banner's status against the clock", async () => {
    const wrapper = await mountList();
    const status = (index: number) =>
      wrapper.get(`[data-test="announcement-banners-row-status-${index}"]`).text();

    expect(status(0)).toBe("Live");
    expect(status(1)).toBe("Live");
    expect(status(2)).toBe("Scheduled");
    expect(status(3)).toBe("Ended");
    expect(status(4)).toBe("Live · ends in 1h");
  });

  it("summarises audience and appearance", async () => {
    const rows = (await mountList()).vm.rows as any[];

    expect(rows[0].audience).toBe("All orgs");
    expect(rows[1].audience).toBe("2 orgs");
    expect(rows[0].appearance).toBe("Medium · Severity colour");
    expect(rows[0].schedule).toBe("Until turned off");
    expect(rows[4].schedule).toMatch(/ → .+ \S+$/);
    expect(rows[3].appearance).toBe("Medium · Blue");
    expect(rows[4].appearance).toBe("Small · Severity colour");
  });

  it("renders the message as markdown in the table", async () => {
    const message = (await mountList()).get('[data-test="announcement-banners-row-message-0"]');

    expect(message.find("strong").text()).toBe("today");
  });

  it("shows only live banners in server order, hiding promos under a critical", async () => {
    const wrapper = await mountList();
    const live = wrapper
      .get('[data-test="announcement-banners-preview"]')
      .findAll('[data-test="announcement-bar-message"]')
      .map((node) => node.text());

    expect(live).toEqual(["Outage", "Window"]);
  });

  it("shows one empty state with an add action when nothing is authored", async () => {
    getConfig.mockResolvedValue({ data: { banners: [] } });
    const wrapper = await mountList();

    expect(wrapper.find('[data-test="announcement-banners-list-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="announcement-banners-preview-empty"]').exists()).toBe(true);
    await wrapper.get('[data-test="announcement-banners-empty-add-btn"]').trigger("click");

    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "announcementBannerEditor",
        query: { org_identifier: "_meta" },
      }),
    );
  });

  it("opens the editor for edit and duplicate", async () => {
    const wrapper = await mountList();

    await wrapper.get('[data-test="announcement-banners-row-edit-2"]').trigger("click");
    await wrapper.get('[data-test="announcement-banners-row-duplicate-3"]').trigger("click");

    expect(push.mock.calls[0][0].query).toEqual({
      org_identifier: "_meta",
      index: "2",
    });
    expect(push.mock.calls[1][0].query).toEqual({
      org_identifier: "_meta",
      duplicate: "3",
    });
  });

  it("confirms with a destructive button quoting the message", async () => {
    const wrapper = await mountList();

    await wrapper.get('[data-test="announcement-banners-row-delete-0"]').trigger("click");
    await flushPromises();

    expect(document.body.textContent).toContain("Delete this banner?");
    expect(
      document.querySelector('[data-test="announcement-banners-delete-message"]')?.textContent,
    ).toContain("“Webinar today” It disappears for everyone immediately.");
    const confirm = document.querySelector('[data-test="announcement-banners-delete-confirm"]');
    expect(confirm?.textContent).toContain("Delete");
    expect(confirm?.classList.contains("bg-negative")).toBe(true);
    wrapper.unmount();
  });

  it("deletes from the latest config immediately and reloads", async () => {
    const wrapper = await mountList();

    await wrapper.get('[data-test="announcement-banners-row-delete-1"]').trigger("click");
    expect((wrapper.vm as any).pendingDelete).toBe(1);
    await (wrapper.vm as any).confirmDelete();

    const saved = setConfig.mock.calls[0][1] as {
      banners: { message: string }[];
    };
    expect(saved.banners.map((banner) => banner.message)).toEqual([
      "Webinar **today**",
      "Later",
      "Over",
      "Window",
    ]);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "positive" }));
    expect(getConfig).toHaveBeenCalledTimes(3);
    wrapper.unmount();
  });

  it("does not delete a banner someone else changed, and refetches", async () => {
    const wrapper = await mountList();
    getConfig.mockResolvedValue({
      data: {
        banners: [{ message: "Someone else's", variant: "promo" }, ...STORED.banners.slice(1)],
      },
    });
    (wrapper.vm as any).pendingDelete = 0;

    await (wrapper.vm as any).confirmDelete();

    expect(setConfig).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "negative",
        message: expect.stringContaining("someone else"),
      }),
    );
    expect((wrapper.vm as any).rows[0].draft.message).toBe("Someone else's");
  });

  it("surfaces the server's delete error verbatim", async () => {
    setConfig.mockRejectedValue({
      response: { data: { message: "config locked by peer" } },
    });
    const wrapper = await mountList();
    (wrapper.vm as any).pendingDelete = 0;

    await (wrapper.vm as any).confirmDelete();

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "negative",
        message: "config locked by peer",
      }),
    );
  });

  it("shows the load error inline", async () => {
    getConfig.mockRejectedValue({
      response: { data: { message: "forbidden" } },
    });
    const wrapper = await mountList();

    expect(wrapper.get('[data-test="announcement-banners-error"]').text()).toContain("forbidden");
  });
});
