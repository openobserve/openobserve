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

import { describe, expect, it } from "vitest";

import { validateBanner } from "./AnnouncementBannerDialog.validation";
import { emptyDraft, type BannerDraft } from "./announcementDrafts";

/** Messages are wired through i18n in the component; the key is enough here. */
const t = (key: string) => key;

const draft = (overrides: Partial<BannerDraft> = {}): BannerDraft => ({
  ...emptyDraft(),
  ...overrides,
});

/** The fields the validator complained about. */
const issuesFor = (value: BannerDraft): string[] => Object.keys(validateBanner(value, t));

describe("validateBanner", () => {
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
    const issues = issuesFor(draft({ message: "m", hasCta: true, ctaText: "", ctaUrl: "" }));

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
