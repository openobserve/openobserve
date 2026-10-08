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

import { mount, flushPromises } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/locales";

const getActive = vi.fn();

vi.mock("@/services/announcements", () => ({
  default: { getActive: (...args: unknown[]) => getActive(...args) },
}));

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));

const mockStore = {
  state: reactive({ theme: "light", selectedOrganization: { identifier: "acme" } }),
};

vi.mock("vuex", () => ({ useStore: () => mockStore }));

import { useAnnouncementDraftPreview } from "@/composables/useAnnouncementDraftPreview";
import AnnouncementBanner from "./AnnouncementBanner.vue";

async function mountWith(banner: Record<string, unknown>) {
  getActive.mockResolvedValue({
    data: {
      banners: [{ id: "b1", message: "Hello", variant: "info", dismissible: true, ...banner }],
    },
  });
  const wrapper = mount(AnnouncementBanner, {
    global: { plugins: [i18n], stubs: { "q-icon": true } },
  });
  await flushPromises();
  return wrapper;
}

describe("AnnouncementBanner", () => {
  it("renders medium text and the variant fill when nothing is authored", async () => {
    mockStore.state.theme = "light";
    const bar = (await mountWith({})).get('[data-test="announcement-banner-info"]');

    expect(bar.classes()).toContain("announcement-bar--text-medium");
    expect(bar.classes()).toContain("announcement-bar--info");
    expect(bar.attributes("style")).toBeUndefined();
  });

  it("applies the authored size", async () => {
    const bar = (await mountWith({ text_size: "large" })).get(".announcement-bar");

    expect(bar.classes()).toContain("announcement-bar--text-large");
  });

  it("uses the colour for the current mode through custom properties and follows a theme toggle", async () => {
    mockStore.state.theme = "light";
    const wrapper = await mountWith({ colors: { light: "#FEF3C7", dark: "#1E3A8A" } });
    const bar = () => wrapper.get(".announcement-bar");

    expect(bar().classes()).toContain("announcement-bar--custom");
    expect(bar().classes()).not.toContain("announcement-bar--info");
    expect(bar().attributes("style")).toContain("--announcement-bg: #FEF3C7");
    expect(bar().attributes("style")).toContain("--announcement-fg: #171717");
    expect(bar().attributes("style")).not.toMatch(/(^|;)\s*(background|color):/);

    mockStore.state.theme = "dark";
    await nextTick();

    expect(bar().attributes("style")).toContain("--announcement-bg: #1E3A8A");
    expect(bar().attributes("style")).toContain("--announcement-fg: #FFFFFF");
  });

  it("falls back to the variant fill for a mode with no colour", async () => {
    mockStore.state.theme = "dark";
    const bar = (await mountWith({ colors: { light: "#FEF3C7" } })).get(".announcement-bar");

    expect(bar.classes()).toContain("announcement-bar--info");
    expect(bar.classes()).not.toContain("announcement-bar--custom");
    expect(bar.attributes("style")).toBeUndefined();
  });

  it("renders the message as limited markdown", async () => {
    const message = (
      await mountWith({
        message: "**Down** for _maintenance_, see [status](https://s.example.com)",
      })
    ).get('[data-test="announcement-bar-message"]');

    expect(message.find("strong").text()).toBe("Down");
    expect(message.find("em").text()).toBe("maintenance");
    const link = message.get("a");
    expect(link.attributes("href")).toBe("https://s.example.com");
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener noreferrer");
  });

  it("never renders markup smuggled into the message", async () => {
    const message = (
      await mountWith({ message: '<img src=x onerror="alert(1)"> [x](javascript:alert(1))' })
    ).get('[data-test="announcement-bar-message"]');

    expect(message.find("img").exists()).toBe(false);
    expect(message.html()).not.toContain("javascript:");
  });

  it("applies each text size", async () => {
    for (const size of ["small", "medium", "large"]) {
      const bar = (await mountWith({ text_size: size })).get(".announcement-bar");
      expect(bar.classes()).toContain(`announcement-bar--text-${size}`);
    }
  });

  it("keeps the CTA and dismiss together in one action group", async () => {
    const bar = (
      await mountWith({ message: "x ".repeat(80), cta: { text: "Details", url: "https://x.dev" } })
    ).get(".announcement-bar");

    const actions = bar.get(".announcement-bar-actions");
    expect(actions.text()).toContain("Details");
    expect(actions.text()).toContain("Dismiss");
    expect(bar.get(".announcement-bar-text").find(".announcement-bar-icon").exists()).toBe(true);
  });

  it("shows the editor's draft in place of the banner it edits, tagged and inert", async () => {
    const { setDraft } = useAnnouncementDraftPreview();
    const wrapper = await mountWith({ message: "Hello" });

    setDraft(
      {
        id: "x",
        message: "Hello, edited",
        variant: "warning",
        dismissible: false,
        cta: { text: "Docs", url: "" },
      },
      "Hello",
    );
    await nextTick();

    const draftBar = wrapper.get('[data-test="announcement-banner-draft-preview"]');
    expect(draftBar.text()).toContain("Hello, edited");
    expect(draftBar.text()).toContain("Preview");
    expect(draftBar.text()).toContain("Docs");
    expect(draftBar.find("a").exists()).toBe(false);
    expect(draftBar.find("button").exists()).toBe(false);
    expect(wrapper.find('[data-test="announcement-banner-info"]').exists()).toBe(false);

    setDraft(null);
    await nextTick();
    expect(wrapper.find('[data-test="announcement-banner-draft-preview"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="announcement-banner-info"]').exists()).toBe(true);
  });

  it("refetches as soon as a save is announced", async () => {
    const { notifyConfigChanged } = useAnnouncementDraftPreview();
    await mountWith({});
    const calls = getActive.mock.calls.length;

    notifyConfigChanged();
    await flushPromises();

    expect(getActive.mock.calls.length).toBeGreaterThan(calls);
  });
});
