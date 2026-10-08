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
import AnnouncementBannerEditorForm from "./AnnouncementBannerEditorForm.vue";
import { makeBannerSchema } from "./AnnouncementBannerEditor.schema";
import { emptyDraft, type BannerDraft, type BannerStyle } from "./announcementDrafts";

vi.mock("@/services/announcements", () => ({
  default: { getActive: vi.fn(), getConfig: vi.fn(), setConfig: vi.fn() },
}));

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...args: any[]) => mockToast(...args) }));

const mockPush = vi.fn();
vi.mock("vue-router", async () => {
  const actual = await vi.importActual<any>("vue-router");
  return { ...actual, useRouter: () => ({ push: mockPush }), onBeforeRouteLeave: vi.fn() };
});

const service = announcements as unknown as Record<string, ReturnType<typeof vi.fn>>;

const store = {
  state: {
    theme: "light",
    zoConfig: { meta_org: "_meta" },
    selectedOrganization: { identifier: "_meta" },
    organizations: [{ identifier: "acme" }],
  },
};

const t = (key: string) => i18n.global.t(key) as string;
const schema = makeBannerSchema(t);

const draft = (overrides: Record<string, unknown> = {}) => ({ ...emptyDraft(), ...overrides });

/** The paths the schema complained about. */
const issuesFor = (value: unknown): string[] => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("makeBannerSchema", () => {
  it("accepts a banner with nothing but a message", () => {
    expect(issuesFor(draft({ message: "Heads up" }))).toEqual([]);
  });

  it("requires a message", () => {
    expect(issuesFor(draft({ message: "   " }))).toContain("message");
  });

  it("rejects a duration that is not a span", () => {
    expect(issuesFor(draft({ message: "m", schedule: "duration", duration: "soon" }))).toContain(
      "duration",
    );
    expect(issuesFor(draft({ message: "m", schedule: "duration", duration: "90m" }))).toEqual([]);
  });

  it("wants at least one end of a scheduled window", () => {
    expect(issuesFor(draft({ message: "m", schedule: "window" }))).toContain("startsAt");
    expect(
      issuesFor(draft({ message: "m", schedule: "window", startsAt: "2026-08-12T02:00" })),
    ).toEqual([]);
  });

  it("rejects a window that ends before it starts, as the server would", () => {
    const issues = issuesFor(
      draft({
        message: "m",
        schedule: "window",
        startsAt: "2026-08-12T04:00",
        endsAt: "2026-08-12T02:00",
      }),
    );

    expect(issues).toContain("endsAt");
  });

  it("ignores schedule fields the chosen mode does not use", () => {
    // A leftover bad duration from a previous choice must not block a save.
    expect(issuesFor(draft({ message: "m", schedule: "always", duration: "nonsense" }))).toEqual(
      [],
    );
  });

  it("requires both halves of a CTA once it is turned on", () => {
    const issues = issuesFor(draft({ message: "m", hasCta: true }));

    expect(issues).toContain("ctaText");
    expect(issues).toContain("ctaUrl");
  });

  it("rejects a CTA link that is not http(s)", () => {
    // The same rule the server enforces — a javascript: URL never reaches an anchor.
    expect(
      issuesFor(
        draft({ message: "m", hasCta: true, ctaText: "Go", ctaUrl: "javascript:alert(1)" }),
      ),
    ).toContain("ctaUrl");

    expect(
      issuesFor(draft({ message: "m", hasCta: true, ctaText: "Go", ctaUrl: "https://x.dev" })),
    ).toEqual([]);
  });

  it("rejects a colour that is not #RRGGBB, and allows none", () => {
    expect(issuesFor(draft({ message: "m", colorLight: "red", colorDark: "#FFF" }))).toEqual([
      "colorLight",
      "colorDark",
    ]);
    expect(issuesFor(draft({ message: "m", colorLight: "", colorDark: "#1E3A8A" }))).toEqual([]);
  });

  it("ignores CTA fields while the CTA is off", () => {
    expect(issuesFor(draft({ message: "m", hasCta: false, ctaUrl: "not-a-url" }))).toEqual([]);
  });
});

describe("AnnouncementBannerEditorForm", () => {
  const stored = [{ message: "First" }, { message: "Second", variant: "warning" }];

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    service.getConfig.mockResolvedValue({ data: { banners: stored } });
    service.setConfig.mockResolvedValue({ data: {} });
  });

  const mountForm = async (
    draft: Partial<BannerDraft> = {},
    index: number | null = null,
    original: Record<string, unknown> | null = index === null ? null : stored[index],
    extra: { others?: BannerDraft[]; styles?: BannerStyle[] } = {},
  ) => {
    const wrapper = mount(AnnouncementBannerEditorForm, {
      props: {
        draft: { ...emptyDraft(), ...draft },
        index,
        others: extra.others ?? [],
        original,
        styles: extra.styles ?? [],
      },
      global: { plugins: [i18n], provide: { store } },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  };

  const submit = async (wrapper: Awaited<ReturnType<typeof mountForm>>) => {
    await (wrapper.vm as any).form.handleSubmit();
    await flushPromises();
  };

  const savedConfig = () => service.setConfig.mock.calls[0][1];
  const savedBanners = () => savedConfig().banners;

  it("lays out every section and previews both theme modes", async () => {
    await mountForm({ message: "Both modes" });

    for (const part of ["message", "variant", "style", "icon", "has-cta", "schedule", "audience"]) {
      expect(
        document.querySelector(`[data-test="announcement-editor-${part}"]`),
        part,
      ).not.toBeNull();
    }
    for (const mode of ["light", "dark"]) {
      const frame = document.querySelector(`[data-test="announcement-editor-preview-${mode}"]`);
      expect(frame?.getAttribute("data-banner-theme")).toBe(mode);
      expect(frame?.textContent).toContain("Both modes");
    }
  });

  it("replaces the edited banner in place and leaves the others untouched", async () => {
    const wrapper = await mountForm({ message: "Second, edited", variant: "warning" }, 1);
    await submit(wrapper);

    expect(service.setConfig).toHaveBeenCalledWith("_meta", expect.anything());
    expect(savedBanners()).toEqual([
      { message: "First" },
      { message: "Second, edited", variant: "warning" },
    ]);
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ name: "announcementBanners" }));
  });

  it("appends a new banner with the chosen preset colours", async () => {
    const wrapper = await mountForm({ message: "New" });

    document
      .querySelector<HTMLElement>('[data-test="announcement-editor-color-preset-amber"]')!
      .click();
    await submit(wrapper);

    expect(savedBanners()[2]).toEqual({
      message: "New",
      id: expect.stringMatching(/^banner-/),
      colors: { light: "#FEF3C7", dark: "#78350F" },
    });
  });

  it("sends a duration as typed, for the server to pin to an absolute end", async () => {
    const wrapper = await mountForm({ message: "Timed", schedule: "duration", duration: "2h" });
    await submit(wrapper);

    expect(savedBanners()[2]).toMatchObject({ message: "Timed", duration: "2h" });
  });

  it("writes back config keys it does not edit", async () => {
    service.getConfig.mockResolvedValue({
      data: { banners: stored, styles: [{ id: "s", name: "S" }], future: { keep: true } },
    });
    const wrapper = await mountForm({ message: "Second", variant: "warning" }, 1);
    await submit(wrapper);

    expect(savedConfig()).toMatchObject({
      styles: [{ id: "s", name: "S" }],
      future: { keep: true },
    });
  });

  it("shows the server's reason when the save is rejected", async () => {
    service.setConfig.mockRejectedValue({
      response: { data: { message: "banners[2].cta.url must start with http" } },
    });
    const wrapper = await mountForm({ message: "Bad" });
    await submit(wrapper);

    expect(
      document.querySelector('[data-test="announcement-editor-error"]')?.textContent,
    ).toContain("banners[2].cta.url");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("wraps the message with the toolbar", async () => {
    const wrapper = await mountForm({ message: "" });
    (wrapper.vm as any).applyFormat("bold");
    await flushPromises();

    expect((wrapper.vm as any).form.state.values.message).toBe("**text**");
  });

  it("refuses to overwrite a banner someone else changed meanwhile", async () => {
    const wrapper = await mountForm({ message: "Mine" }, 1, { message: "What I opened" });
    await submit(wrapper);

    expect(service.setConfig).not.toHaveBeenCalled();
    expect(document.querySelector('[data-test="announcement-editor-reload"]')).not.toBeNull();
  });

  it("turns dismissing off when the banner becomes critical", async () => {
    const wrapper = await mountForm({ message: "Outage", dismissible: true });
    (wrapper.vm as any).form.setFieldValue("variant", "critical");
    await flushPromises();

    expect((wrapper.vm as any).form.state.values.dismissible).toBe(false);
  });

  it("gives the banner a fresh id when dismissals are reset", async () => {
    const wrapper = await mountForm({ message: "Second", variant: "warning" }, 1);
    document
      .querySelector<HTMLElement>(
        '[data-test="announcement-editor-reset-dismissals"] button, [data-test="announcement-editor-reset-dismissals"]',
      )!
      .click();
    await flushPromises();
    await submit(wrapper);

    expect(savedBanners()[1].id).toMatch(/^banner-/);
  });

  it("names the action after what saving will do", async () => {
    await mountForm({ message: "Now" });
    expect(document.querySelector('[data-test="announcement-editor-save"]')?.textContent).toContain(
      "Publish now",
    );
  });

  it("caps the button text so the bar stays readable on phones", () => {
    const paths = issuesFor(
      draft({ message: "m", hasCta: true, ctaText: "x".repeat(31), ctaUrl: "https://a.dev" }),
    );
    expect(paths).toContain("ctaText");
  });

  const release: BannerStyle = {
    id: "style-1",
    name: "Release",
    base: "promo",
    icon: "rocket-launch",
    textSize: "large",
    colorLight: "#DBEAFE",
    colorDark: "#1E3A8A",
  };

  it("copies a saved style's look into the banner", async () => {
    const wrapper = await mountForm({ message: "v2 is out" }, null, null, { styles: [release] });
    (wrapper.vm as any).chooseStyle("style:style-1");
    await flushPromises();
    await submit(wrapper);

    expect(savedBanners()[2]).toMatchObject({
      variant: "promo",
      icon: "rocket-launch",
      text_size: "large",
      colors: { light: "#DBEAFE", dark: "#1E3A8A" },
      style: "style-1",
    });
  });

  it("drops the style label once the look is changed", async () => {
    const wrapper = await mountForm({ message: "v2" }, null, null, { styles: [release] });
    (wrapper.vm as any).chooseStyle("style:style-1");
    await flushPromises();
    (wrapper.vm as any).form.setFieldValue("icon", "info");
    await flushPromises();

    expect((wrapper.vm as any).form.state.values.styleId).toBe("");
  });

  it("saves the current look as a style without touching the banners", async () => {
    await mountForm({ message: "m", variant: "warning", icon: "build" });
    document.querySelector<HTMLElement>('[data-test="announcement-editor-save-style"]')!.click();
    await flushPromises();
    const input = document.querySelector<HTMLInputElement>(
      '[data-test="announcement-editor-style-name"] input, input[data-test="announcement-editor-style-name"]',
    )!;
    input.value = "Maintenance";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    document
      .querySelector<HTMLElement>(
        '[data-test="announcement-editor-save-style-dialog"] [data-test="o-dialog-primary-btn"]',
      )!
      .click();
    await flushPromises();

    expect(savedConfig().banners).toEqual(stored);
    expect(savedConfig().styles).toEqual([
      { id: expect.stringMatching(/^style-/), name: "Maintenance", base: "warning", icon: "build" },
    ]);
  });

  it("warns only when a critical banner reaches every org the promotion targets", async () => {
    const critical = {
      ...emptyDraft(),
      message: "Down",
      variant: "critical" as const,
      orgs: ["a"],
    };
    const hidden = '[data-test="announcement-editor-preview-hidden"]';

    await mountForm({ message: "Promo", variant: "promo", orgs: ["a"] }, null, null, {
      others: [critical],
    });
    expect(document.querySelector(hidden)).not.toBeNull();

    document.body.innerHTML = "";
    await mountForm({ message: "Promo", variant: "promo", orgs: ["a", "b"] }, null, null, {
      others: [critical],
    });
    expect(document.querySelector(hidden)).toBeNull();
  });
});
