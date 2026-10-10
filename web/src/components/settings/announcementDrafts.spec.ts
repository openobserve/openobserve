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
  authoredFromStyle,
  bannerStatus,
  configFromDrafts,
  draftFromAuthored,
  draftsFromConfig,
  emptyDraft,
  isHiddenByCritical,
  newBannerId,
  parseDurationMs,
  stylesFromConfig,
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

  it("reads a fixed window", () => {
    const draft = draftFromAuthored({
      message: "m",
      starts_at: toRfc3339("2026-08-12T02:00"),
      ends_at: toRfc3339("2026-08-12T04:00"),
    });

    expect(draft).toMatchObject({ start: "at", end: "at", endsAt: "2026-08-12T04:00" });
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

    expect(draft.links).toEqual([
      { text: "Status", url: "https://s.io" },
      { text: "Docs", url: "https://d.io" },
    ]);
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
});

describe("authoredFromDraft", () => {
  it("writes only what differs from the defaults", () => {
    const draft = { ...emptyDraft(), message: "Just this" };

    expect(authoredFromDraft(draft)).toEqual({ message: "Just this" });
  });

  it("writes a duration only when the banner ends after a span", () => {
    const draft = { ...emptyDraft(), message: "m", end: "after" as const, duration: "1h" };

    expect(authoredFromDraft(draft)).toEqual({ message: "m", duration: "1h" });
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
    expect(authoredFromDraft({ ...draft, start: "now", end: "never" })).toEqual({ message: "m" });
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

describe("the form/JSON round trip", () => {
  it("returns the same config it was given", () => {
    const config = {
      banners: [
        { message: "Outage", variant: "critical", dismissible: false },
        { message: "Webinar", variant: "promo", ctas: [{ text: "Join", url: "https://x.dev" }] },
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

describe("appearance", () => {
  it("reads text size and per-mode colours", () => {
    const draft = draftFromAuthored({
      message: "m",
      text_size: "large",
      colors: { light: "#DBEAFE", dark: "#1E3A8A" },
    });

    expect(draft).toMatchObject({ textSize: "large", colorLight: "#DBEAFE", colorDark: "#1E3A8A" });
  });

  it("falls back to the defaults for values it cannot use", () => {
    const draft = draftFromAuthored({
      message: "m",
      text_size: "huge",
      colors: { light: "blue", dark: "#FFF" },
    });

    expect(draft).toMatchObject({ textSize: "medium", colorLight: "", colorDark: "" });
  });

  it("omits defaults and uppercases colours on write", () => {
    expect(authoredFromDraft({ ...emptyDraft(), message: "m" })).toEqual({ message: "m" });
    expect(
      authoredFromDraft({ ...emptyDraft(), message: "m", textSize: "small", colorDark: "#1e3a8a" }),
    ).toEqual({ message: "m", text_size: "small", colors: { dark: "#1E3A8A" } });
  });

  it("round-trips a styled banner", () => {
    const config = {
      banners: [
        { message: "Styled", text_size: "large", colors: { light: "#FEF3C7", dark: "#78350F" } },
      ],
    };

    expect(configFromDrafts(draftsFromConfig(config))).toEqual(config);
  });
});

describe("bannerStatus", () => {
  const now = new Date("2026-10-08T12:00").getTime();
  const at = (value: string) => ({
    ...emptyDraft(),
    start: "at" as const,
    end: "at" as const,
    ...JSON.parse(value),
  });

  it("reads a window against the clock", () => {
    expect(bannerStatus(at('{"startsAt":"2026-10-08T13:00"}'), now)).toBe("scheduled");
    expect(bannerStatus(at('{"endsAt":"2026-10-08T11:00"}'), now)).toBe("ended");
    expect(
      bannerStatus(at('{"startsAt":"2026-10-08T11:00","endsAt":"2026-10-08T13:00"}'), now),
    ).toBe("live");
    expect(bannerStatus(emptyDraft(), now)).toBe("live");
  });
});

describe("isHiddenByCritical", () => {
  const critical = (orgs: string[]) => ({ ...emptyDraft(), variant: "critical" as const, orgs });
  const promo = (orgs: string[]) => ({ ...emptyDraft(), variant: "promo" as const, orgs });

  it("hides a promotion only where a live critical banner also shows", () => {
    expect(isHiddenByCritical(promo([]), [critical([])])).toBe(true);
    expect(isHiddenByCritical(promo(["a"]), [critical(["a", "b"])])).toBe(true);
    expect(isHiddenByCritical(promo(["a", "c"]), [critical(["a"])])).toBe(false);
    expect(isHiddenByCritical(promo([]), [critical(["a"])])).toBe(false);
    expect(isHiddenByCritical({ ...promo([]), variant: "info" }, [critical([])])).toBe(false);
  });

  it("ignores critical banners that are not live", () => {
    const ended = { ...critical([]), end: "at" as const, endsAt: "2000-01-01T00:00" };
    expect(isHiddenByCritical(promo([]), [ended])).toBe(false);
  });
});

describe("styles", () => {
  it("round-trips a saved style and drops what it cannot use", () => {
    const authored = {
      id: "s1",
      name: "Release",
      icon: "rocket-launch",
      text_size: "large",
      colors: { light: "#DBEAFE", dark: "#1E3A8A" },
    };
    const [style] = stylesFromConfig({ styles: [authored, { id: "", name: "x" }, "junk"] });

    expect(authoredFromStyle(style)).toEqual(authored);
    expect(stylesFromConfig({ styles: [{ id: "a", name: "A", icon: "skull" }] })[0]).toMatchObject({
      icon: "",
      textSize: "medium",
    });
  });

  it("keeps the style a banner was copied from, and its icon", () => {
    const draft = draftFromAuthored({ message: "m", icon: "build", style: "s1" });
    expect(draft).toMatchObject({ icon: "build", styleId: "s1" });
    expect(authoredFromDraft(draft)).toEqual({ message: "m", icon: "build", style: "s1" });
  });

  it("mints distinct ids", () => {
    expect(newBannerId()).not.toBe(newBannerId());
    expect(newBannerId("style")).toMatch(/^style-/);
  });
});
