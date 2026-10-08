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
const route = { query: {} as Record<string, string> };
let leaveGuard: ((to: unknown, from: unknown, next: (_v?: boolean) => void) => void) | undefined;

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

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ push }),
  onBeforeRouteLeave: (guard: typeof leaveGuard) => {
    leaveGuard = guard;
  },
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      theme: "light",
      zoConfig: { meta_org: "_meta" },
      selectedOrganization: { identifier: "_meta" },
      organizations: [{ identifier: "acme" }, { identifier: "_meta" }],
    },
  }),
}));

import { useAnnouncementDraftPreview } from "@/composables/useAnnouncementDraftPreview";
import AnnouncementBannerEditor from "./AnnouncementBannerEditor.vue";

const STORED = {
  banners: [
    { message: "First", id: "first", duration: "1h" },
    { message: "Second", id: "second", variant: "warning", text_size: "large" },
  ],
};

async function mountEditor(query: Record<string, string> = {}) {
  route.query = query;
  const wrapper = mount(AnnouncementBannerEditor, { global: { plugins: [i18n] } });
  await flushPromises();
  return wrapper;
}

const savedConfig = () => setConfig.mock.calls[0][1] as { banners: Record<string, unknown>[] };

describe("AnnouncementBannerEditor", () => {
  beforeEach(() => {
    getConfig.mockResolvedValue({ data: structuredClone(STORED) });
    setConfig.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.clearAllMocks();
    leaveGuard = undefined;
  });

  it("opens a new banner with an empty form", async () => {
    const wrapper = await mountEditor();

    expect(wrapper.get('[data-test="announcement-editor-title"]').text()).toBe("Add banner");
    expect((wrapper.vm as any).form.message).toBe("");
  });

  it("loads the banner named by ?index", async () => {
    const wrapper = await mountEditor({ index: "1" });

    expect(wrapper.get('[data-test="announcement-editor-title"]').text()).toBe("Edit banner");
    expect((wrapper.vm as any).form.message).toBe("Second");
    expect((wrapper.vm as any).form.textSize).toBe("large");
  });

  it("blocks save and shows field errors when the draft is invalid", async () => {
    const wrapper = await mountEditor();

    await wrapper.get('[data-test="announcement-editor-save"]').trigger("click");
    await flushPromises();

    expect(setConfig).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Enter the message people will see.");
  });

  it("appends a new banner to the latest config and returns to the list", async () => {
    const wrapper = await mountEditor();
    (wrapper.vm as any).form.message = "Fresh";
    (wrapper.vm as any).form.colorLight = "#dbeafe";

    await (wrapper.vm as any).save();

    expect(getConfig).toHaveBeenCalledTimes(2);
    expect(savedConfig().banners).toEqual([
      ...STORED.banners,
      { message: "Fresh", colors: { light: "#DBEAFE" } },
    ]);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "positive" }));
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "announcementBanners" }));
  });

  it("replaces only the edited banner and leaves the others untouched", async () => {
    const wrapper = await mountEditor({ index: "1" });
    (wrapper.vm as any).form.message = "Second, edited";

    await (wrapper.vm as any).save();

    expect(savedConfig().banners).toEqual([
      { message: "First", id: "first", duration: "1h" },
      { message: "Second, edited", id: "second", variant: "warning", text_size: "large" },
    ]);
  });

  it("saves a duration as an absolute end time", async () => {
    const wrapper = await mountEditor();
    Object.assign((wrapper.vm as any).form, {
      message: "Timed",
      schedule: "duration",
      duration: "2h",
    });
    const before = Date.now();

    await (wrapper.vm as any).save();

    const saved = savedConfig().banners[2];
    expect(saved.duration).toBeUndefined();
    const endsAt = new Date(saved.ends_at as string).getTime();
    expect(endsAt).toBeGreaterThanOrEqual(before + 2 * 3_600_000 - 1000);
    expect(endsAt).toBeLessThanOrEqual(Date.now() + 2 * 3_600_000);
  });

  it("duplicates into a new banner with a fresh dismissal key", async () => {
    const wrapper = await mountEditor({ duplicate: "1" });
    expect(wrapper.get('[data-test="announcement-editor-title"]').text()).toBe("Add banner");

    await (wrapper.vm as any).save();

    expect(savedConfig().banners).toHaveLength(3);
    expect(savedConfig().banners[2]).toEqual({
      message: "Second",
      variant: "warning",
      text_size: "large",
    });
  });

  it("shows the server's error inline and stays on the page", async () => {
    setConfig.mockRejectedValue({ response: { data: { message: "banners[2].cta.url: bad" } } });
    const wrapper = await mountEditor();
    (wrapper.vm as any).form.message = "x";

    await (wrapper.vm as any).save();
    await flushPromises();

    expect(wrapper.get('[data-test="announcement-editor-error"]').text()).toContain(
      "banners[2].cta.url: bad",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("returns to the list when ?index names a banner that no longer exists", async () => {
    await mountEditor({ index: "7" });

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "negative" }));
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "announcementBanners" }));
  });

  it("asks in the app's dialog before leaving with unsaved changes", async () => {
    const wrapper = await mountEditor({ index: "0" });
    const next = vi.fn();

    leaveGuard!({ fullPath: "/elsewhere" }, {}, next);
    expect(next).toHaveBeenCalledWith();

    (wrapper.vm as any).form.message = "changed";
    await flushPromises();
    leaveGuard!({ fullPath: "/elsewhere" }, {}, next);
    await flushPromises();

    expect(next).toHaveBeenLastCalledWith(false);
    const discard = document.querySelector('[data-test="announcement-editor-discard"]');
    expect(discard?.classList.contains("bg-negative")).toBe(true);
    expect(document.body.textContent).toContain("Keep editing");

    (discard as HTMLElement).click();
    await flushPromises();
    expect(push).toHaveBeenLastCalledWith("/elsewhere");
    wrapper.unmount();
  });

  it("refuses to overwrite a banner someone else changed and offers a reload", async () => {
    const wrapper = await mountEditor({ index: "1" });
    getConfig.mockResolvedValue({
      data: { banners: [STORED.banners[0], { message: "Changed elsewhere", id: "second" }] },
    });
    (wrapper.vm as any).form.message = "Mine";

    await (wrapper.vm as any).save();
    await flushPromises();

    expect(setConfig).not.toHaveBeenCalled();
    expect(wrapper.get('[data-test="announcement-editor-error"]').text()).toContain(
      "changed by someone else",
    );
    await wrapper.get('[data-test="announcement-editor-reload"]').trigger("click");
    await flushPromises();
    expect((wrapper.vm as any).form.message).toBe("Changed elsewhere");
  });

  it("refuses to save over an index that no longer exists", async () => {
    const wrapper = await mountEditor({ index: "1" });
    getConfig.mockResolvedValue({ data: { banners: [STORED.banners[0]] } });

    await (wrapper.vm as any).save();

    expect(setConfig).not.toHaveBeenCalled();
  });

  it("turns dismissal off when Critical is chosen", async () => {
    const wrapper = await mountEditor();
    expect((wrapper.vm as any).form.dismissible).toBe(true);

    await wrapper.get('[data-test="announcement-editor-variant-critical"]').trigger("click");

    expect((wrapper.vm as any).form.variant).toBe("critical");
    expect((wrapper.vm as any).form.dismissible).toBe(false);
  });

  it("names the save button after what saving does", async () => {
    const wrapper = await mountEditor();
    const label = () => wrapper.get('[data-test="announcement-editor-save"]').text();
    const local = (offsetMs: number) => {
      const d = new Date(Date.now() + offsetMs);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    expect(label()).toBe("Publish now");
    Object.assign((wrapper.vm as any).form, { schedule: "window", startsAt: local(86_400_000) });
    await flushPromises();
    expect(label()).toBe("Schedule");
    Object.assign((wrapper.vm as any).form, { startsAt: "", endsAt: local(-86_400_000) });
    await flushPromises();
    expect(label()).toBe("Save");
  });

  it("says who the banner is live for in the toast", async () => {
    const wrapper = await mountEditor();
    (wrapper.vm as any).form.message = "Hi";
    (wrapper.vm as any).audience = "some";
    (wrapper.vm as any).form.orgs = ["acme", "_meta"];

    await (wrapper.vm as any).save();

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Banner is live for 2 organizations" }),
    );
    expect(savedConfig().banners[2].orgs).toEqual(["acme", "_meta"]);
  });

  it("requires an organization when the audience is limited", async () => {
    const wrapper = await mountEditor();
    (wrapper.vm as any).form.message = "Hi";
    (wrapper.vm as any).audience = "some";

    await (wrapper.vm as any).save();

    expect(setConfig).not.toHaveBeenCalled();
    expect((wrapper.vm as any).errors.orgs).toBe("Pick at least one organization.");
  });

  it("re-validates as fields change once a save was attempted", async () => {
    const wrapper = await mountEditor();
    await (wrapper.vm as any).save();
    expect((wrapper.vm as any).errors.message).toBeTruthy();

    (wrapper.vm as any).form.message = "Fixed";
    await flushPromises();

    expect((wrapper.vm as any).errors.message).toBeUndefined();
  });

  it("assigns a fresh id when asked to show the banner again to people who dismissed it", async () => {
    const wrapper = await mountEditor({ index: "0" });
    expect(wrapper.find('[data-test="announcement-editor-reset-dismissals"]').exists()).toBe(true);

    (wrapper.vm as any).resetDismissals = true;
    await (wrapper.vm as any).save();

    expect(savedConfig().banners[0].id).toMatch(/^banner-[0-9a-z]+$/);
    expect(savedConfig().banners[0].id).not.toBe("first");
  });

  it("keeps the id when dismissals are not reset", async () => {
    const wrapper = await mountEditor({ index: "0" });

    await (wrapper.vm as any).save();

    expect(savedConfig().banners[0].id).toBe("first");
  });

  it("previews an empty message as a muted placeholder, not as content", async () => {
    const wrapper = await mountEditor();

    const edited = wrapper.get('[data-test="announcement-editor-preview-light-edited"]');
    expect(edited.get('[data-test="announcement-bar-placeholder"]').text()).toBe(
      "Your message will appear here",
    );
    expect(edited.find('[data-test="announcement-bar-message"]').exists()).toBe(false);
  });

  it("previews the draft in both themes", async () => {
    const wrapper = await mountEditor({ index: "1" });

    for (const mode of ["light", "dark"]) {
      const frame = wrapper.get(`[data-test="announcement-editor-preview-${mode}"]`);
      expect(frame.get(".announcement-bar").classes()).toContain("announcement-bar--text-large");
      expect(frame.text()).toContain("Second");
    }
  });

  it("stacks the draft with the other live banners by default, in real order", async () => {
    const wrapper = await mountEditor({ index: "1" });

    const frame = wrapper.get('[data-test="announcement-editor-preview-light"]');
    const messages = frame
      .findAll('[data-test="announcement-bar-message"]')
      .map((node) => node.text());
    expect(messages).toEqual(["Second", "First"]);
    expect(frame.find('[data-test="announcement-editor-preview-light-edited"]').exists()).toBe(
      true,
    );
  });

  it("warns and dims a promo that a live critical banner would hide", async () => {
    getConfig.mockResolvedValue({
      data: {
        banners: [
          { message: "Outage", variant: "critical" },
          { message: "Ad", variant: "promo" },
        ],
      },
    });
    const wrapper = await mountEditor({ index: "1" });

    expect(wrapper.find('[data-test="announcement-editor-preview-hidden"]').exists()).toBe(true);
    const edited = wrapper.get('[data-test="announcement-editor-preview-light-edited"]');
    expect(edited.classes()).toContain("announcement-preview-dimmed");
  });

  it("shows its draft in the app's top bar while open, standing in for the edited banner", async () => {
    const { draft, replaces } = useAnnouncementDraftPreview();
    const wrapper = await mountEditor({ index: "1" });

    expect(draft.value?.message).toBe("Second");
    expect(draft.value?.dismissible).toBe(false);
    expect(replaces.value).toBe("Second");

    (wrapper.vm as any).form.message = "Second, live edit";
    await flushPromises();
    expect(draft.value?.message).toBe("Second, live edit");

    await wrapper.get('[data-test="announcement-editor-preview-in-app"]').trigger("click");
    expect(draft.value).toBeNull();
    expect(wrapper.get('[data-test="announcement-editor-preview-caption"]').text()).toBe(
      "Links are disabled in the preview.",
    );

    await wrapper.get('[data-test="announcement-editor-preview-in-app"]').trigger("click");
    expect(draft.value).not.toBeNull();
    wrapper.unmount();
    expect(draft.value).toBeNull();
  });

  it("tells the live bar to refetch after a save", async () => {
    const { configVersion } = useAnnouncementDraftPreview();
    const before = configVersion.value;
    const wrapper = await mountEditor();
    (wrapper.vm as any).form.message = "Fresh";

    await (wrapper.vm as any).save();

    expect(configVersion.value).toBe(before + 1);
  });
});
