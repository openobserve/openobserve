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

import { validateBanner } from "./announcementValidation";
import { emptyDraft, type BannerDraft } from "./announcementDrafts";

/** Messages are wired through i18n in the component; the key is enough here. */
const t = (key: string) => key;

const draft = (overrides: Partial<BannerDraft> = {}): BannerDraft => ({
  ...emptyDraft(),
  ...overrides,
});

/** The fields the validator complained about, with link buttons as `links.N.field`. */
const issuesFor = (value: BannerDraft): string[] => {
  const { links, ...fields } = validateBanner(value, t);
  return [
    ...Object.keys(fields),
    ...(links ?? []).flatMap((errors, position) =>
      Object.keys(errors).map((field) => `links.${position}.${field}`),
    ),
  ];
};

describe("validateBanner", () => {
  it("accepts a banner with nothing but a message", () => {
    expect(issuesFor(draft({ message: "Heads up" }))).toEqual([]);
  });

  it("requires a message", () => {
    expect(issuesFor(draft({ message: "   " }))).toContain("message");
  });

  it("rejects a duration that is not a span", () => {
    expect(issuesFor(draft({ message: "m", end: "after", duration: "soon" }))).toContain(
      "duration",
    );
    expect(issuesFor(draft({ message: "m", end: "after", duration: "90m" }))).toEqual([]);
  });

  it("wants the times the chosen start and end use", () => {
    expect(issuesFor(draft({ message: "m", start: "at" }))).toContain("startsAt");
    expect(issuesFor(draft({ message: "m", end: "at" }))).toContain("endsAt");
    expect(issuesFor(draft({ message: "m", start: "at", startsAt: "2026-08-12T02:00" }))).toEqual(
      [],
    );
  });

  it("rejects an end before the start, as the server would", () => {
    const issues = issuesFor(
      draft({
        message: "m",
        start: "at",
        startsAt: "2026-08-12T04:00",
        end: "at",
        endsAt: "2026-08-12T02:00",
      }),
    );

    expect(issues).toContain("endsAt");
  });

  it("ignores schedule fields the chosen options do not use", () => {
    // A leftover bad duration from a previous choice must not block a save.
    expect(issuesFor(draft({ message: "m", end: "never", duration: "nonsense" }))).toEqual([]);
  });

  it("requires both halves of every link button", () => {
    const issues = issuesFor(draft({ message: "m", links: [{ text: "", url: "" }] }));

    expect(issues).toEqual(["links.0.text", "links.0.url"]);
  });

  it("rejects a link that is not http(s)", () => {
    // The same rule the server enforces — a javascript: URL never reaches an anchor.
    const link = (url: string) => ({ text: "Go", url });
    expect(issuesFor(draft({ message: "m", links: [link("javascript:alert(1)")] }))).toEqual([
      "links.0.url",
    ]);
    expect(issuesFor(draft({ message: "m", links: [link("https://x.dev")] }))).toEqual([]);
  });

  it("accepts empty colours and six-digit hexes", () => {
    expect(issuesFor(draft({ message: "m" }))).toEqual([]);
    expect(issuesFor(draft({ message: "m", colorLight: "#dbeafe", colorDark: "#1E3A8A" }))).toEqual(
      [],
    );
  });

  it("rejects a colour the server would reject", () => {
    expect(issuesFor(draft({ message: "m", colorLight: "#FFF" }))).toContain("colorLight");
    expect(issuesFor(draft({ message: "m", colorDark: "1E3A8A" }))).toContain("colorDark");
    expect(issuesFor(draft({ message: "m", colorDark: "navy" }))).toContain("colorDark");
  });

  it("caps the button text at 30 characters", () => {
    const link = (text: string) => [{ text, url: "https://x.dev" }];

    expect(issuesFor(draft({ message: "m", links: link("x".repeat(30)) }))).toEqual([]);
    expect(issuesFor(draft({ message: "m", links: link("x".repeat(31)) }))).toEqual([
      "links.0.text",
    ]);
  });
});
