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
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import announcements from "@/services/announcements";
import AnnouncementBannerList from "./AnnouncementBannerList.vue";

vi.mock("@/services/announcements", () => ({
  default: { getActive: vi.fn(), getConfig: vi.fn(), setConfig: vi.fn() },
}));

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...args: any[]) => mockToast(...args) }));

const mockPush = vi.fn();
vi.mock("vue-router", async () => {
  const actual = await vi.importActual<any>("vue-router");
  return { ...actual, useRouter: () => ({ push: mockPush }) };
});

const service = announcements as unknown as Record<string, ReturnType<typeof vi.fn>>;

const store = {
  state: {
    theme: "light",
    zoConfig: { meta_org: "_meta" },
    selectedOrganization: { identifier: "_meta" },
  },
};

// Renders every cell slot per row; the real table virtualizes and lays out nothing in jsdom.
const OTableStub = {
  props: ["data", "columns"],
  template: `<div data-test="announcement-list-table">
    <div v-for="row in data" :key="row.index">
      <template v-for="col in columns" :key="col.id">
        <slot :name="'cell-' + col.id" :row="row">{{ row[col.accessorKey] }}</slot>
      </template>
    </div>
    <slot v-if="!data.length" name="empty" />
  </div>`,
};

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe("AnnouncementBannerList", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    service.getConfig.mockResolvedValue({
      data: {
        banners: [
          { message: "**Outage** now", variant: "critical" },
          { message: "Later", starts_at: iso(HOUR) },
          { message: "Over", ends_at: iso(-HOUR) },
        ],
      },
    });
    service.setConfig.mockResolvedValue({ data: {} });
  });

  const mountList = async () => {
    const wrapper = mount(AnnouncementBannerList, {
      global: { plugins: [i18n], provide: { store }, stubs: { OTable: OTableStub } },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  };

  it("marks each banner live, scheduled or ended", async () => {
    await mountList();

    const status = (i: number) =>
      document.querySelector(`[data-test="announcement-list-status-${i}"]`)?.textContent?.trim();
    expect([status(0), status(1), status(2)]).toEqual(["Live", "Scheduled", "Ended"]);
  });

  it("shows only what is live in the live strip, as plain readable text in the table", async () => {
    await mountList();

    const live = document.querySelector('[data-test="announcement-list-live"]');
    expect(live?.textContent).toContain("Outage");
    expect(live?.textContent).not.toContain("Later");
    expect(document.querySelector('[data-test="announcement-list-table"]')?.textContent).toContain(
      "Outage now",
    );
  });

  it("removes a banner after confirmation and saves the rest", async () => {
    await mountList();

    document.querySelector<HTMLElement>('[data-test="announcement-list-delete-1"]')!.click();
    await flushPromises();
    document
      .querySelector<HTMLElement>(
        '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]',
      )!
      .click();
    await flushPromises();

    expect(service.setConfig).toHaveBeenCalledWith("_meta", {
      banners: [
        { message: "**Outage** now", variant: "critical" },
        { message: "Over", ends_at: expect.any(String) },
      ],
    });
  });

  it("opens the editor for a row, a copy, or a new banner", async () => {
    await mountList();

    document.querySelector<HTMLElement>('[data-test="announcement-list-duplicate-0"]')!.click();
    document.querySelector<HTMLElement>('[data-test="announcement-list-add-btn"]')!.click();

    expect(mockPush.mock.calls[0][0]).toMatchObject({
      name: "announcementBannerEditor",
      query: { duplicate: "0" },
    });
    expect(mockPush.mock.calls[1][0].query).not.toHaveProperty("index");
  });

  it("marks a promo hidden while a critical banner is live", async () => {
    service.getConfig.mockResolvedValue({
      data: {
        banners: [
          { message: "Down", variant: "critical" },
          { message: "Webinar", variant: "promo" },
        ],
      },
    });
    await mountList();

    expect(
      document.querySelector('[data-test="announcement-list-status-1"]')?.textContent?.trim(),
    ).toBe("Live · hidden");
  });

  it("does not delete when the banner changed since the list loaded", async () => {
    await mountList();
    service.getConfig.mockResolvedValue({ data: { banners: [{ message: "Someone else's" }] } });

    document.querySelector<HTMLElement>('[data-test="announcement-list-delete-0"]')!.click();
    await flushPromises();
    document
      .querySelector<HTMLElement>(
        '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]',
      )!
      .click();
    await flushPromises();

    expect(service.setConfig).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });
});
