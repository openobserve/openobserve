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
const notifyChanged = vi.fn();
const route = { query: {} as Record<string, string> };
let leaveGuard: ((to: unknown, from: unknown, next: (_v?: boolean) => void) => void) | undefined;

vi.mock("@/services/announcements", () => ({
  default: {
    getConfig: (...args: unknown[]) => getConfig(...args),
    setConfig: (...args: unknown[]) => setConfig(...args),
  },
}));

vi.mock("@/composables/useAnnouncementBanners", () => ({
  notifyAnnouncementsChanged: () => notifyChanged(),
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

import AnnouncementBannerEditor from "./AnnouncementBannerEditor.vue";

const STORED = {
  banners: [
    { message: "First", id: "first", duration: "1h" },
    { message: "Second", id: "second", variant: "warning", text_size: "large" },
  ],
};

async function mountEditor(query: Record<string, string> = {}) {
  route.query = query;
  const wrapper = mount(AnnouncementBannerEditor, {
    global: { plugins: [i18n] },
  });
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
      {
        message: "Fresh",
        id: expect.stringMatching(/^banner-/),
        colors: { light: "#DBEAFE" },
      },
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
      {
        message: "Second, edited",
        id: "second",
        variant: "warning",
        text_size: "large",
      },
    ]);
  });

  it("sends a duration as typed, for the server to pin", async () => {
    const wrapper = await mountEditor();
    Object.assign((wrapper.vm as any).form, {
      message: "Timed",
      end: "after",
      duration: "2h",
    });

    await (wrapper.vm as any).save();

    expect(savedConfig().banners[2]).toMatchObject({
      message: "Timed",
      duration: "2h",
    });
  });

  it("duplicates into a new banner with a fresh dismissal key", async () => {
    const wrapper = await mountEditor({ duplicate: "1" });
    expect(wrapper.get('[data-test="announcement-editor-title"]').text()).toBe("Add banner");

    await (wrapper.vm as any).save();

    expect(savedConfig().banners).toHaveLength(3);
    expect(savedConfig().banners[2]).toEqual({
      message: "Second",
      id: expect.stringMatching(/^banner-/),
      variant: "warning",
      text_size: "large",
    });
    expect(savedConfig().banners[2].id).not.toBe("second");
  });

  it("shows the server's error inline and stays on the page", async () => {
    setConfig.mockRejectedValue({
      response: { data: { message: "banners[2].cta.url: bad" } },
    });
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
      data: {
        banners: [STORED.banners[0], { message: "Changed elsewhere", id: "second" }],
      },
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
    Object.assign((wrapper.vm as any).form, {
      start: "at",
      startsAt: local(86_400_000),
    });
    await flushPromises();
    expect(label()).toBe("Schedule");
    Object.assign((wrapper.vm as any).form, {
      start: "now",
      end: "at",
      endsAt: local(-86_400_000),
    });
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
      expect.objectContaining({
        message: "Banner is live for 2 organizations",
      }),
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

    const edited = wrapper.get('[data-test="announcement-editor-preview-light"]');
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

  it("warns only when a critical banner reaches every org the promotion targets", async () => {
    const config = (promoOrgs?: string[]) => ({
      data: {
        banners: [
          { message: "Outage", variant: "critical", orgs: ["a"] },
          {
            message: "Ad",
            variant: "promo",
            ...(promoOrgs ? { orgs: promoOrgs } : {}),
          },
        ],
      },
    });
    const hidden = '[data-test="announcement-editor-preview-hidden"]';

    getConfig.mockResolvedValue(config(["a"]));
    expect((await mountEditor({ index: "1" })).find(hidden).exists()).toBe(true);

    getConfig.mockResolvedValue(config());
    expect((await mountEditor({ index: "1" })).find(hidden).exists()).toBe(false);
  });

  const STYLED = {
    ...STORED,
    styles: [
      {
        id: "style-1",
        name: "Release",
        icon: "rocket-launch",
        text_size: "large",
        colors: { light: "#DBEAFE", dark: "#1E3A8A" },
      },
    ],
  };

  it("copies a saved style's look into the banner", async () => {
    getConfig.mockResolvedValue({ data: structuredClone(STYLED) });
    const wrapper = await mountEditor();
    (wrapper.vm as any).form.message = "v2 is out";
    (wrapper.vm as any).chooseStyle("style:style-1");

    await (wrapper.vm as any).save();

    expect(savedConfig().banners[2].variant).toBeUndefined();
    expect(savedConfig().banners[2]).toMatchObject({
      icon: "rocket-launch",
      text_size: "large",
      colors: { light: "#DBEAFE", dark: "#1E3A8A" },
      style: "style-1",
    });
    expect(savedConfig()).toMatchObject({ styles: STYLED.styles });
  });

  it("switching a saved style to Custom keeps its look but drops its name", async () => {
    getConfig.mockResolvedValue({ data: structuredClone(STYLED) });
    const wrapper = await mountEditor();
    (wrapper.vm as any).chooseStyle("style:style-1");
    (wrapper.vm as any).chooseStyle("custom");
    await flushPromises();

    expect((wrapper.vm as any).form).toMatchObject({
      styleId: "",
      icon: "rocket-launch",
      textSize: "large",
    });
  });

  it("shows the look controls only for a custom style", async () => {
    const wrapper = await mountEditor();
    const look = '[data-test="announcement-editor-custom-look"]';
    expect(wrapper.find(look).exists()).toBe(false);

    (wrapper.vm as any).chooseStyle("custom");
    await flushPromises();
    expect(wrapper.find(look).exists()).toBe(true);
  });

  it("saves several link buttons, up to three", async () => {
    const wrapper = await mountEditor();
    (wrapper.vm as any).form.message = "m";
    for (let i = 0; i < 3; i++) {
      await wrapper.get('[data-test="announcement-editor-add-link"]').trigger("click");
    }
    expect(wrapper.find('[data-test="announcement-editor-add-link"]').exists()).toBe(false);
    (wrapper.vm as any).form.links = [
      { text: "Status", url: "https://s.io" },
      { text: "Docs", url: "https://d.io" },
    ];

    await (wrapper.vm as any).save();

    expect(savedConfig().banners[2].ctas).toEqual([
      { text: "Status", url: "https://s.io" },
      { text: "Docs", url: "https://d.io" },
    ]);
  });

  it("saves the current look as a style without touching the banners", async () => {
    const wrapper = await mountEditor();
    (wrapper.vm as any).chooseStyle("custom");
    (wrapper.vm as any).form.icon = "build";
    await flushPromises();
    await wrapper.get('[data-test="announcement-editor-save-style"]').trigger("click");
    await flushPromises();
    const name = document.querySelector<HTMLInputElement>(
      '[data-test="announcement-editor-style-name"]',
    )!;
    name.value = "Maintenance";
    name.dispatchEvent(new Event("input"));
    await flushPromises();
    document
      .querySelector<HTMLElement>('[data-test="announcement-editor-save-style-confirm"]')!
      .click();
    await flushPromises();

    expect(savedConfig().banners).toEqual(STORED.banners);
    expect((savedConfig() as any).styles).toEqual([
      {
        id: expect.stringMatching(/^style-/),
        name: "Maintenance",
        icon: "build",
      },
    ]);
    expect((wrapper.vm as any).form.styleId).toMatch(/^style-/);
  });

  it("tells the live bar to refetch after a save", async () => {
    const wrapper = await mountEditor();
    (wrapper.vm as any).form.message = "Fresh";

    await (wrapper.vm as any).save();

    expect(notifyChanged).toHaveBeenCalledTimes(1);
  });
});
