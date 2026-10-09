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
  draftFromAuthored,
  draftsFromConfig,
  indexedDraftsFromConfig,
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
    expect(draft).toMatchObject({ start: "now", end: "never", links: [] });
    expect(draft.dismissible).toBe(true);
    expect(draft.orgs).toEqual([]);
  });

  it("defaults the appearance to medium text and the variant's colours", () => {
    const draft = draftFromAuthored({ message: "Heads up" });

    expect(draft.textSize).toBe("medium");
    expect(draft.colorLight).toBe("");
    expect(draft.colorDark).toBe("");
  });

  it("reads text size and colours, uppercasing the hex", () => {
    const draft = draftFromAuthored({
      message: "m",
      text_size: "large",
      colors: { light: "#1d4ed8", dark: "#93C5FD" },
    });

    expect(draft.textSize).toBe("large");
    expect(draft.colorLight).toBe("#1D4ED8");
    expect(draft.colorDark).toBe("#93C5FD");
  });

  it("falls back to defaults for an unknown size or a colour that is not a hex", () => {
    const draft = draftFromAuthored({
      message: "m",
      text_size: "huge",
      colors: { light: "red", dark: "#FFF" },
    });

    expect(draft.textSize).toBe("medium");
    expect(draft.colorLight).toBe("");
    expect(draft.colorDark).toBe("");
  });

  it("reads a duration-only banner as ending after a span", () => {
    const draft = draftFromAuthored({ message: "Back soon", duration: "90m" });

    expect(draft).toMatchObject({ start: "now", end: "after", duration: "90m" });
  });

  it("keeps starts_at + duration as a set start that ends after a span", () => {
    const draft = draftFromAuthored({
      message: "Maintenance",
      starts_at: toRfc3339("2026-08-12T02:00"),
      duration: "2h",
    });

    expect(draft).toMatchObject({
      start: "at",
      startsAt: "2026-08-12T02:00",
      end: "after",
      duration: "2h",
    });
  });

  it("keeps an explicit id so an edit does not re-show a dismissed banner", () => {
    expect(draftFromAuthored({ message: "m", id: "maint" }).id).toBe("maint");
  });

  it("ignores a variant it does not recognise", () => {
    expect(draftFromAuthored({ message: "m", variant: "chartreuse" }).variant).toBe("info");
  });

  it("picks up link buttons from either field, and the orgs", () => {
    const draft = draftFromAuthored({
      message: "m",
      ctas: [
        { text: "Status", url: "https://s.io" },
        { text: "Docs", url: "https://d.io" },
      ],
      orgs: ["acme", 42 as unknown as string],
    });

    expect(draft.links.map((link) => link.text)).toEqual(["Status", "Docs"]);
    expect(draft.orgs).toEqual(["acme"]);
    expect(
      draftFromAuthored({ message: "m", cta: { text: "Go", url: "https://g.io" } }).links,
    ).toEqual([{ text: "Go", url: "https://g.io" }]);
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

  it("keeps each draft's stored index so an edit replaces the right entry", () => {
    const entries = indexedDraftsFromConfig({
      banners: [{ message: "  " }, { message: "second" }, null, { message: "fourth" }],
    });

    expect(entries.map((entry) => [entry.index, entry.draft.message])).toEqual([
      [1, "second"],
      [3, "fourth"],
    ]);
  });
});

describe("authoredFromDraft", () => {
  it("writes only what differs from the defaults", () => {
    const draft = { ...emptyDraft(), message: "Just this" };

    expect(authoredFromDraft(draft)).toEqual({ message: "Just this" });
  });

  it("sends a duration as typed, for the server to pin to an absolute end", () => {
    const draft = {
      ...emptyDraft(),
      message: "m",
      end: "after" as const,
      duration: "2h",
    };

    expect(authoredFromDraft(draft)).toEqual({ message: "m", duration: "2h" });
  });

  it("reopens a server-pinned duration as an end-only window", () => {
    const draft = draftFromAuthored({
      message: "m",
      ends_at: "2026-08-12T03:30:00Z",
    });

    expect(draft).toMatchObject({ start: "now", end: "at" });
    expect(draft.endsAt).toBe(toLocalInput("2026-08-12T03:30:00Z"));
  });

  it("writes nothing for an unparseable duration", () => {
    const draft = {
      ...emptyDraft(),
      message: "m",
      end: "after" as const,
      duration: "x",
    };

    expect(authoredFromDraft(draft)).toEqual({ message: "m" });
  });

  it("writes only the times the chosen start and end use", () => {
    const draft = {
      ...emptyDraft(),
      message: "m",
      start: "at" as const,
      startsAt: "2026-08-12T02:00",
      end: "at" as const,
      endsAt: "2026-08-12T04:00",
      // Left over from a previous choice — it must not leak into the payload.
      duration: "1h",
    };

    const authored = authoredFromDraft(draft);

    expect(authored.duration).toBeUndefined();
    expect(authored.starts_at).toMatch(/^2026-08-12T02:00:00[+-]\d{2}:\d{2}$/);
    expect(authored.ends_at).toMatch(/^2026-08-12T04:00:00[+-]\d{2}:\d{2}$/);
  });

  it("writes link buttons as ctas and drops half-filled rows", () => {
    const draft = {
      ...emptyDraft(),
      message: "m",
      links: [
        { text: " Status ", url: "https://s.io" },
        { text: "", url: "https://x.io" },
      ],
    };

    expect(authoredFromDraft(draft)).toEqual({
      message: "m",
      ctas: [{ text: "Status", url: "https://s.io" }],
    });
  });

  it("writes dismissible only when it is false", () => {
    expect(authoredFromDraft({ ...emptyDraft(), message: "m" }).dismissible).toBeUndefined();
    expect(
      authoredFromDraft({ ...emptyDraft(), message: "m", dismissible: false }).dismissible,
    ).toBe(false);
  });
});

describe("authoredFromDraft appearance", () => {
  it("omits a medium text size and empty colours", () => {
    const authored = authoredFromDraft({ ...emptyDraft(), message: "m" });

    expect(authored).not.toHaveProperty("text_size");
    expect(authored).not.toHaveProperty("colors");
  });

  it("writes a non-default size and only the modes that have a colour", () => {
    const authored = authoredFromDraft({
      ...emptyDraft(),
      message: "m",
      textSize: "small",
      colorLight: "#dbeafe",
    });

    expect(authored.text_size).toBe("small");
    expect(authored.colors).toEqual({ light: "#DBEAFE" });
  });

  it("drops a colour that is not a hex rather than sending it", () => {
    const authored = authoredFromDraft({
      ...emptyDraft(),
      message: "m",
      colorDark: "blue",
    });

    expect(authored).not.toHaveProperty("colors");
  });
});

const roundTrip = (config: unknown) => ({
  banners: draftsFromConfig(config).map((draft) => authoredFromDraft(draft)),
});

describe("the form/JSON round trip", () => {
  it("returns the same config it was given", () => {
    const config = {
      banners: [
        { message: "Outage", variant: "critical", dismissible: false },
        {
          message: "Webinar",
          variant: "promo",
          ctas: [{ text: "Join", url: "https://x.dev" }],
        },
        { message: "Scoped", orgs: ["acme"] },
        {
          message: "Styled",
          text_size: "large",
          colors: { light: "#1D4ED8", dark: "#93C5FD" },
        },
        {
          message: "Dark only",
          text_size: "small",
          colors: { dark: "#14532D" },
        },
      ],
    };

    expect(roundTrip(config)).toEqual(config);
  });

  it("survives a second trip unchanged", () => {
    // A config must not drift a little further on every save.
    const once = roundTrip({ banners: [{ message: "Stable" }] });

    expect(roundTrip(once)).toEqual(once);
  });
});
