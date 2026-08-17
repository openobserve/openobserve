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

import {
  authoredFromDraft,
  configFromDrafts,
  draftFromAuthored,
  draftsFromConfig,
  emptyDraft,
  parseDurationMs,
  toLocalInput,
  toRfc3339,
} from "./announcementDrafts";

describe("parseDurationMs", () => {
  it("reads the spans the server accepts", () => {
    expect(parseDurationMs("30m")).toBe(30 * 60_000);
    expect(parseDurationMs("2h")).toBe(2 * 3_600_000);
    expect(parseDurationMs("3d")).toBe(3 * 86_400_000);
    expect(parseDurationMs(" 1w ")).toBe(604_800_000);
  });

  it("rejects anything that is not one", () => {
    expect(parseDurationMs("")).toBeNull();
    expect(parseDurationMs("soon")).toBeNull();
    expect(parseDurationMs("0h")).toBeNull();
    expect(parseDurationMs("5")).toBeNull();
  });
});

describe("timestamp conversion", () => {
  it("round-trips a picked time through RFC 3339 and back", () => {
    const picked = "2026-08-12T02:00";

    expect(toLocalInput(toRfc3339(picked))).toBe(picked);
  });

  it("stamps an offset, because the server rejects a naive timestamp", () => {
    expect(toRfc3339("2026-08-12T02:00")).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it("returns an empty string rather than an Invalid Date", () => {
    expect(toLocalInput("not a date")).toBe("");
    expect(toLocalInput(undefined)).toBe("");
    expect(toRfc3339("")).toBe("");
  });
});

describe("draftFromAuthored", () => {
  it("defaults everything but the message", () => {
    const draft = draftFromAuthored({ message: "Heads up" });

    expect(draft.message).toBe("Heads up");
    expect(draft.variant).toBe("info");
    expect(draft.schedule).toBe("always");
    expect(draft.dismissible).toBe(true);
    expect(draft.hasCta).toBe(false);
    expect(draft.orgs).toEqual([]);
  });

  it("reads a duration-only banner as a duration schedule", () => {
    const draft = draftFromAuthored({ message: "Back soon", duration: "90m" });

    expect(draft.schedule).toBe("duration");
    expect(draft.duration).toBe("90m");
  });

  it("resolves starts_at + duration into a window rather than losing half of it", () => {
    // The form has no third control for that pair, but dropping the end would
    // quietly turn a timed notice into a permanent one.
    const draft = draftFromAuthored({
      message: "Maintenance",
      starts_at: toRfc3339("2026-08-12T02:00"),
      duration: "2h",
    });

    expect(draft.schedule).toBe("window");
    expect(draft.startsAt).toBe("2026-08-12T02:00");
    expect(draft.endsAt).toBe("2026-08-12T04:00");
  });

  it("keeps an explicit id so an edit does not re-show a dismissed banner", () => {
    expect(draftFromAuthored({ message: "m", id: "maint" }).id).toBe("maint");
  });

  it("ignores a variant it does not recognise", () => {
    expect(draftFromAuthored({ message: "m", variant: "chartreuse" }).variant).toBe("info");
  });

  it("picks up a CTA and its orgs", () => {
    const draft = draftFromAuthored({
      message: "m",
      cta: { text: "Docs", url: "https://example.com" },
      orgs: ["acme", 42 as unknown as string],
    });

    expect(draft.hasCta).toBe(true);
    expect(draft.ctaText).toBe("Docs");
    expect(draft.orgs).toEqual(["acme"]);
  });
});

describe("draftsFromConfig", () => {
  it("survives anything that is not a banner list", () => {
    expect(draftsFromConfig(null)).toEqual([]);
    expect(draftsFromConfig({})).toEqual([]);
    expect(draftsFromConfig({ banners: "nope" })).toEqual([]);
  });

  it("drops entries with no message, which could not be saved anyway", () => {
    const drafts = draftsFromConfig({
      banners: [{ message: "keep" }, { message: "  " }, null, { variant: "info" }],
    });

    expect(drafts.map((d) => d.message)).toEqual(["keep"]);
  });
});

describe("authoredFromDraft", () => {
  it("writes only what differs from the defaults", () => {
    const draft = { ...emptyDraft(), message: "Just this" };

    expect(authoredFromDraft(draft)).toEqual({ message: "Just this" });
  });

  it("writes a duration only in duration mode", () => {
    const draft = { ...emptyDraft(), message: "m", schedule: "duration" as const, duration: "1h" };

    expect(authoredFromDraft(draft)).toEqual({ message: "m", duration: "1h" });
  });

  it("writes offset timestamps only in window mode", () => {
    const draft = {
      ...emptyDraft(),
      message: "m",
      schedule: "window" as const,
      startsAt: "2026-08-12T02:00",
      endsAt: "2026-08-12T04:00",
      // Left over from a previous choice — it must not leak into the payload.
      duration: "1h",
    };

    const authored = authoredFromDraft(draft);

    expect(authored.duration).toBeUndefined();
    expect(authored.starts_at).toMatch(/^2026-08-12T02:00:00[+-]\d{2}:\d{2}$/);
    expect(authored.ends_at).toMatch(/^2026-08-12T04:00:00[+-]\d{2}:\d{2}$/);
  });

  it("omits a CTA that was toggled off", () => {
    const draft = {
      ...emptyDraft(),
      message: "m",
      hasCta: false,
      ctaText: "Docs",
      ctaUrl: "https://example.com",
    };

    expect(authoredFromDraft(draft).cta).toBeUndefined();
  });

  it("writes dismissible only when it is false", () => {
    expect(authoredFromDraft({ ...emptyDraft(), message: "m" }).dismissible).toBeUndefined();
    expect(
      authoredFromDraft({ ...emptyDraft(), message: "m", dismissible: false }).dismissible,
    ).toBe(false);
  });
});

describe("the form/JSON round trip", () => {
  it("returns the same config it was given", () => {
    const config = {
      banners: [
        { message: "Outage", variant: "critical", dismissible: false },
        { message: "Webinar", variant: "promo", cta: { text: "Join", url: "https://x.dev" } },
        { message: "Scoped", orgs: ["acme"] },
        { message: "Timed", duration: "1h" },
      ],
    };

    expect(configFromDrafts(draftsFromConfig(config))).toEqual(config);
  });

  it("survives a second trip unchanged", () => {
    // Convergence matters: an author toggling between Form and JSON must not
    // watch their config drift a little further on every switch.
    const once = configFromDrafts(draftsFromConfig({ banners: [{ message: "Stable" }] }));

    expect(configFromDrafts(draftsFromConfig(once))).toEqual(once);
  });
});
