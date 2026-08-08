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
import { createStore } from "vuex";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import announcements from "@/services/announcements";
import AnnouncementBanners from "./AnnouncementBanners.vue";

vi.mock("@/services/announcements", () => ({
  default: {
    getConfig: vi.fn(),
    setConfig: vi.fn(),
  },
}));

const store = createStore({
  state: {
    zoConfig: { meta_org: "_meta" },
    organizations: [{ identifier: "acme" }, { identifier: "globex" }],
  },
});

async function mountEditor(saved: unknown = { banners: [] }) {
  vi.mocked(announcements.getConfig).mockResolvedValue({ data: saved } as any);

  const wrapper = mount(AnnouncementBanners, {
    props: { open: true },
    global: { plugins: [i18n, store] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

/** ODrawer teleports its body, so assertions run against the document. */
const q = (selector: string) => document.querySelector(selector);
const qa = (selector: string) => Array.from(document.querySelectorAll(selector));
const textOf = (selector: string) => q(selector)?.textContent ?? "";

describe("AnnouncementBanners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("reads the authored config from the meta org", async () => {
    await mountEditor();

    expect(announcements.getConfig).toHaveBeenCalledWith("_meta");
  });

  it("authors through the form, with no raw-JSON surface", async () => {
    await mountEditor();

    expect(q('[data-test="announcement-banners-list"]') !== null).toBe(true);
    expect(q('[data-test="announcement-banners-editor"]') !== null).toBe(false);
    expect(q('[data-test="announcement-banners-mode"]') !== null).toBe(false);
  });

  it("builds a card per saved banner", async () => {
    await mountEditor({
      banners: [{ message: "First" }, { message: "Second", variant: "critical" }],
    });

    expect(qa('[data-test^="announcements-banner-card-"]').length).toBeGreaterThan(0);
    expect(textOf('[data-test="announcements-banner-card-0"]')).toContain("First");
    expect(textOf('[data-test="announcements-banner-card-1"]')).toContain("Second");
  });

  it("says so when nothing is configured yet", async () => {
    await mountEditor();

    expect(q('[data-test="announcement-banners-list-empty"]') !== null).toBe(true);
  });

  it("previews in render order, not authored order", async () => {
    // The whole point of the preview: authored order is not what users see.
    await mountEditor({
      banners: [
        { message: "promo one", variant: "promo" },
        { message: "notice one", variant: "info" },
        { message: "warning one", variant: "warning" },
      ],
    });

    const preview = textOf('[data-test="announcement-banners-preview"]');

    expect(preview.indexOf("warning one")).toBeLessThan(preview.indexOf("notice one"));
    expect(preview.indexOf("notice one")).toBeLessThan(preview.indexOf("promo one"));
  });

  it("hides promos in the preview exactly as the live bar does", async () => {
    await mountEditor({
      banners: [
        { message: "webinar", variant: "promo" },
        { message: "outage", variant: "critical" },
      ],
    });

    const preview = textOf('[data-test="announcement-banners-preview"]');

    expect(preview).toContain("outage");
    expect(preview).not.toContain("webinar");
  });

  it("says so when the config would render no banner", async () => {
    await mountEditor();

    expect(q('[data-test="announcement-banners-preview-empty"]') !== null).toBe(true);
  });

  it("publishes what the form holds", async () => {
    const wrapper = await mountEditor({
      banners: [{ message: "Ship it", cta: { text: "Docs", url: "https://example.com/a//b" } }],
    });
    vi.mocked(announcements.setConfig).mockResolvedValue({ data: {} } as any);

    await (wrapper.vm as any).save();

    expect(announcements.setConfig).toHaveBeenCalledWith("_meta", {
      banners: [{ message: "Ship it", cta: { text: "Docs", url: "https://example.com/a//b" } }],
    });
  });

  it("adds a banner through the dialog", async () => {
    const wrapper = await mountEditor();
    vi.mocked(announcements.setConfig).mockResolvedValue({ data: {} } as any);

    (wrapper.vm as any).editingIndex = -1;
    (wrapper.vm as any).applyDraft({
      id: "",
      message: "Added from the form",
      variant: "warning",
      schedule: "always",
      duration: "",
      startsAt: "",
      endsAt: "",
      dismissible: true,
      hasCta: false,
      ctaText: "",
      ctaUrl: "",
      orgs: [],
    });
    await flushPromises();

    await (wrapper.vm as any).save();

    expect(announcements.setConfig).toHaveBeenCalledWith("_meta", {
      banners: [{ message: "Added from the form", variant: "warning" }],
    });
  });

  it("surfaces the server's message when publishing is rejected", async () => {
    const wrapper = await mountEditor();
    vi.mocked(announcements.setConfig).mockRejectedValue({
      response: { data: { message: "banners[0].message must not be empty" } },
    });

    await (wrapper.vm as any).save();
    await flushPromises();

    expect(textOf('[data-test="announcement-banners-error"]')).toContain(
      "banners[0].message must not be empty",
    );
  });

  it("discards edits by re-reading what is published", async () => {
    const wrapper = await mountEditor();
    vi.mocked(announcements.getConfig).mockClear();

    await (wrapper.vm as any).reload();

    expect(announcements.getConfig).toHaveBeenCalledWith("_meta");
  });

  it("publishes and discards from the drawer footer", async () => {
    // Pinned in the footer rather than floating mid-body, so they stay reachable
    // however long the banner list gets.
    await mountEditor();
    vi.mocked(announcements.setConfig).mockResolvedValue({ data: {} } as any);

    const publish = q('[data-test="o-drawer-primary-btn"]') as HTMLElement;
    const discard = q('[data-test="o-drawer-secondary-btn"]') as HTMLElement;
    expect(publish).not.toBeNull();
    expect(discard).not.toBeNull();

    publish.click();
    await flushPromises();
    expect(announcements.setConfig).toHaveBeenCalled();

    vi.mocked(announcements.getConfig).mockClear();
    discard.click();
    await flushPromises();
    expect(announcements.getConfig).toHaveBeenCalledWith("_meta");
  });

  it("reads the config when the drawer opens, not before", async () => {
    // The component now outlives the drawer, so an unopened Settings page must
    // not fetch, and a second open must not show the first open's leftovers.
    vi.mocked(announcements.getConfig).mockResolvedValue({ data: { banners: [] } } as any);

    const wrapper = mount(AnnouncementBanners, {
      props: { open: false },
      global: { plugins: [i18n, store] },
      attachTo: document.body,
    });
    await flushPromises();
    expect(announcements.getConfig).not.toHaveBeenCalled();

    await wrapper.setProps({ open: true });
    await flushPromises();
    expect(announcements.getConfig).toHaveBeenCalledWith("_meta");
  });
});
