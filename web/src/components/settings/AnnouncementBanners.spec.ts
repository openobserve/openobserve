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
  state: { zoConfig: { meta_org: "_meta" } },
});

// The Monaco editor is an async import that never resolves under jsdom, so it is
// absent from the tree here. Everything asserted below sits outside it.
async function mountEditor(saved: unknown = { banners: [] }) {
  vi.mocked(announcements.getConfig).mockResolvedValue({ data: saved } as any);

  const wrapper = mount(AnnouncementBanners, { global: { plugins: [i18n, store] } });
  await flushPromises();
  return wrapper;
}

describe("AnnouncementBanners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the authored config from the meta org", async () => {
    await mountEditor();

    expect(announcements.getConfig).toHaveBeenCalledWith("_meta");
  });

  it("shows the example without any interaction", async () => {
    const wrapper = await mountEditor();

    expect(wrapper.find('[data-test="announcement-banners-reference"]').isVisible()).toBe(true);
    expect(wrapper.find('[data-test="announcement-banners-example"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="announcement-banners-insert-example-btn"]').exists()).toBe(
      true,
    );
  });

  it("documents every field the server accepts, in the example itself", async () => {
    // The field table is gone; the example is now the only reference, so it has
    // to name every field or the schema becomes undiscoverable.
    const example = (await mountEditor())
      .find('[data-test="announcement-banners-example"]')
      .text();

    for (const field of [
      "message",
      "variant",
      "starts_at",
      "ends_at",
      "duration",
      "dismissible",
      "cta",
      "orgs",
      "id",
    ]) {
      expect(example, `example does not mention ${field}`).toContain(field);
    }
  });

  it("holds the editor back until the saved config is in hand", async () => {
    // Creating Monaco while the drawer is still animating open lays it out at
    // zero width and paints an empty black panel on every reopen.
    vi.mocked(announcements.getConfig).mockReturnValue(new Promise(() => {}) as any);
    const wrapper = mount(AnnouncementBanners, { global: { plugins: [i18n, store] } });

    expect(wrapper.find('[data-test="announcement-banners-editor-loading"]').exists()).toBe(true);
  });

  it("publishes and discards from under the editor", async () => {
    const wrapper = await mountEditor();

    expect(wrapper.find('[data-test="announcement-banners-save-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="announcement-banners-discard-btn"]').exists()).toBe(true);
  });

  it("remounts the editor when the buffer is replaced behind its back", async () => {
    // CodeQueryEditor reads `query` only at monaco.editor.create() and never
    // watches it, so a changed `:key` is the only thing that makes Insert
    // example — or a reload — actually reach the editor.
    const wrapper = await mountEditor();
    const before = (wrapper.vm as any).bufferKey;

    await wrapper.find('[data-test="announcement-banners-insert-example-btn"]').trigger("click");

    expect((wrapper.vm as any).bufferKey).toBeGreaterThan(before);
    expect((wrapper.vm as any).editorValue).toContain('"banners"');
    expect((wrapper.vm as any).editorValue).toContain("Scheduled maintenance");
  });

  it("says so when the config would render no banner", async () => {
    const wrapper = await mountEditor();

    expect(wrapper.find('[data-test="announcement-banners-preview-empty"]').exists()).toBe(true);
  });

  it("previews the banners that are configured", async () => {
    const wrapper = await mountEditor({ banners: [{ message: "Preview me", variant: "warning" }] });

    const preview = wrapper.find('[data-test="announcement-banners-preview"]');
    expect(preview.text()).toContain("Preview me");
    expect(wrapper.find('[data-test="announcement-banners-preview-empty"]').exists()).toBe(false);
  });

  it("publishes the buffer, stripping the comments first", async () => {
    const wrapper = await mountEditor({
      banners: [{ message: "Ship it", cta: { text: "Docs", url: "https://example.com/a//b" } }],
    });
    vi.mocked(announcements.setConfig).mockResolvedValue({ data: {} } as any);

    await (wrapper.vm as any).save();

    expect(announcements.setConfig).toHaveBeenCalledWith("_meta", {
      banners: [{ message: "Ship it", cta: { text: "Docs", url: "https://example.com/a//b" } }],
    });
  });

  it("surfaces the server's message when publishing is rejected", async () => {
    const wrapper = await mountEditor();
    vi.mocked(announcements.setConfig).mockRejectedValue({
      response: { data: { message: "banners[0].message must not be empty" } },
    });

    await (wrapper.vm as any).save();
    await flushPromises();

    expect(wrapper.find('[data-test="announcement-banners-error"]').text()).toContain(
      "banners[0].message must not be empty",
    );
  });

  it("discards edits by re-reading what is published", async () => {
    const wrapper = await mountEditor();
    vi.mocked(announcements.getConfig).mockClear();

    await (wrapper.vm as any).reload();

    expect(announcements.getConfig).toHaveBeenCalledWith("_meta");
  });
});
