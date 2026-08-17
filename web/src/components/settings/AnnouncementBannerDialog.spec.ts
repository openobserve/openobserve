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
import { describe, expect, it } from "vitest";

import i18n from "@/locales";
import AnnouncementBannerDialog from "./AnnouncementBannerDialog.vue";
import { makeBannerSchema } from "./AnnouncementBannerDialog.schema";
import { emptyDraft } from "./announcementDrafts";

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

  it("ignores CTA fields while the CTA is off", () => {
    expect(issuesFor(draft({ message: "m", hasCta: false, ctaUrl: "not-a-url" }))).toEqual([]);
  });
});

describe("AnnouncementBannerDialog", () => {
  const mountDialog = async (overrides: Record<string, unknown> = {}) => {
    const wrapper = mount(AnnouncementBannerDialog, {
      props: {
        open: true,
        draft: { ...emptyDraft(), ...overrides },
        isNew: true,
        orgOptions: [{ label: i18n.global.t("common.all"), value: "acme" }],
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  };

  it("renders the fields an author always needs", async () => {
    await mountDialog();

    // ODialog teleports, so assert against the document rather than the wrapper.
    for (const field of ["message", "variant", "schedule", "dismissible", "has-cta", "orgs"]) {
      expect(
        document.querySelector(`[data-test="announcements-banner-dialog-${field}"]`),
        `${field} is missing`,
      ).not.toBeNull();
    }
  });

  it("shows the schedule controls only for the mode that uses them", async () => {
    const stamps = () => ({
      duration: document.querySelector('[data-test="announcements-banner-dialog-duration"]'),
      startsAt: document.querySelector('[data-test="announcements-banner-dialog-starts-at"]'),
    });

    await mountDialog({ schedule: "always" });
    expect(stamps().duration).toBeNull();
    expect(stamps().startsAt).toBeNull();

    document.body.innerHTML = "";
    await mountDialog({ schedule: "duration" });
    expect(stamps().duration).not.toBeNull();
    expect(stamps().startsAt).toBeNull();

    document.body.innerHTML = "";
    await mountDialog({ schedule: "window" });
    expect(stamps().duration).toBeNull();
    expect(stamps().startsAt).not.toBeNull();
  });

  it("applies a valid banner instead of spinning forever", async () => {
    // The submit has to actually resolve: a schema handed to useOForm as a ref
    // never validates, so Apply span with no emit and no way out of the dialog.
    document.body.innerHTML = "";
    const wrapper = await mountDialog({ message: "Ready to apply", variant: "warning" });

    await (wrapper.vm as any).form.handleSubmit();
    await flushPromises();

    expect(wrapper.emitted("save")).toBeTruthy();
    expect(wrapper.emitted("save")![0][0]).toMatchObject({
      message: "Ready to apply",
      variant: "warning",
    });
    // And the dialog closes, rather than sitting there mid-save.
    expect(wrapper.emitted("update:open")![0]).toEqual([false]);
  });

  it("blocks a banner with no message, without hanging", async () => {
    document.body.innerHTML = "";
    const wrapper = await mountDialog({ message: "" });

    await (wrapper.vm as any).form.handleSubmit();
    await flushPromises();

    expect(wrapper.emitted("save")).toBeFalsy();
    // The submit still settles, so Apply is clickable again once fixed.
    expect((wrapper.vm as any).form.state.isSubmitting).toBe(false);
  });

  it("reveals the CTA fields only once the CTA is turned on", async () => {
    document.body.innerHTML = "";
    await mountDialog({ hasCta: false });
    expect(document.querySelector('[data-test="announcements-banner-dialog-cta-url"]')).toBeNull();

    document.body.innerHTML = "";
    await mountDialog({ hasCta: true });
    expect(
      document.querySelector('[data-test="announcements-banner-dialog-cta-url"]'),
    ).not.toBeNull();
  });
});
