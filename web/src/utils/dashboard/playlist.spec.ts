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
  PLAYLIST_MAX_ENTRIES,
  buildPlaylistQuery,
  buildSlideQuery,
  isFramingBlocked,
  isPlaylistFrameMessage,
  isPlaylistIntervalAdjusted,
  missingReasonFor,
  parsePlaylistEntries,
  parsePlaylistInterval,
  parsePlaylistQuery,
  parsePlaylistSlide,
  pickPlaylistParams,
  serializePlaylistEntries,
  stripPlaylistParams,
  type PlaylistConfig,
} from "./playlist";

const config = (over: Partial<PlaylistConfig> = {}): PlaylistConfig => ({
  org: "acme",
  entries: [
    { dashboardId: "d1", folderId: "default" },
    { dashboardId: "d 2", folderId: "ops:team" },
  ],
  intervalSeconds: 60,
  slideIndex: 0,
  period: "1h",
  theme: "dark",
  fit: true,
  timezone: null,
  ...over,
});

describe("playlist URL contract", () => {
  describe("entries", () => {
    it("round-trips ids that contain separators", () => {
      const entries = [
        { dashboardId: "a,b", folderId: "x:y" },
        { dashboardId: "plain", folderId: "default" },
      ];
      expect(parsePlaylistEntries(serializePlaylistEntries(entries))).toEqual(entries);
    });

    it("defaults a missing folder and drops empty, duplicate and malformed entries", () => {
      expect(parsePlaylistEntries("d1,,d1:default,:f2,d3:,%E0%A4%A,d4:ops")).toEqual([
        { dashboardId: "d1", folderId: "default" },
        { dashboardId: "d3", folderId: "default" },
        { dashboardId: "d4", folderId: "ops" },
      ]);
    });

    it("treats a missing, empty or array value safely", () => {
      expect(parsePlaylistEntries(undefined)).toEqual([]);
      expect(parsePlaylistEntries("")).toEqual([]);
      expect(parsePlaylistEntries(["d1:f1", "d2:f2"])).toEqual([
        { dashboardId: "d1", folderId: "f1" },
      ]);
    });

    it("caps the list at 50 entries on parse and on serialize", () => {
      const many = Array.from({ length: 60 }, (_, i) => ({
        dashboardId: `d${i}`,
        folderId: "default",
      }));
      const parsed = parsePlaylistEntries(many.map((e) => `${e.dashboardId}:f`).join(","));
      expect(parsed).toHaveLength(PLAYLIST_MAX_ENTRIES);
      expect(parsed.at(-1)?.dashboardId).toBe("d49");
      expect(serializePlaylistEntries(many).split(",")).toHaveLength(PLAYLIST_MAX_ENTRIES);
    });
  });

  describe("interval", () => {
    it.each([
      ["1m", 60],
      ["30s", 30],
      ["90", 90],
      ["2h", 3600],
      ["1s", 10],
      [undefined, 60],
      ["abc", 60],
      ["0", 60],
      ["-5m", 60],
    ])("%s → %i seconds", (value, seconds) => {
      expect(parsePlaylistInterval(value)).toBe(seconds);
    });

    it("reads m as minutes, not months", () => {
      expect(parsePlaylistInterval("5m")).toBe(300);
    });
  });

  describe("slide", () => {
    it.each([
      ["1", 0],
      ["3", 2],
      ["9", 4],
      ["0", 0],
      ["-2", 0],
      ["x", 0],
      [undefined, 0],
    ])("slide=%s of 5 → index %i", (value, index) => {
      expect(parsePlaylistSlide(value, 5)).toBe(index);
    });
  });

  it("parses a full player URL", () => {
    expect(
      parsePlaylistQuery({
        org_identifier: "acme",
        playlist: "d1:default,d%202:ops%3Ateam",
        interval: "2m",
        slide: "2",
        period: "24h",
        theme: "light",
        fit: "true",
        timezone: "UTC",
      }),
    ).toEqual({
      org: "acme",
      entries: [
        { dashboardId: "d1", folderId: "default" },
        { dashboardId: "d 2", folderId: "ops:team" },
      ],
      intervalSeconds: 120,
      slideIndex: 1,
      period: "24h",
      theme: "light",
      fit: true,
      timezone: "UTC",
    });
  });

  it("ignores garbage period and theme and returns null without dashboards", () => {
    const parsed = parsePlaylistQuery({ playlist: "d1", period: "yesterday", theme: "neon" });
    expect(parsed?.period).toBeNull();
    expect(parsed?.theme).toBe("current");
    expect(parsed?.fit).toBe(false);
    expect(parsePlaylistQuery({ playlist: ",,," })).toBeNull();
    expect(parsePlaylistQuery({})).toBeNull();
  });

  it("serializes the player query and parses it back to the same config", () => {
    const query = buildPlaylistQuery(config({ slideIndex: 1 }));
    expect(query).toEqual({
      org_identifier: "acme",
      playlist: "d1:default,d%202:ops%3Ateam",
      interval: "1m",
      slide: "2",
      period: "1h",
      theme: "dark",
      fit: "true",
    });
    expect(parsePlaylistQuery(query)).toEqual(config({ slideIndex: 1 }));
  });

  it("leaves out period, theme and fit when they are each dashboard's own", () => {
    const query = buildPlaylistQuery(config({ period: null, theme: "current", fit: false }));
    expect(query.period).toBeUndefined();
    expect(query.theme).toBeUndefined();
    expect(query.fit).toBeUndefined();
  });

  describe("slide URLs", () => {
    it("builds a frame URL in kiosk with the shared options and no variables or tab", () => {
      expect(buildSlideQuery(config(), 1, "frame")).toEqual({
        org_identifier: "acme",
        dashboard: "d 2",
        folder: "ops:team",
        kiosk: "true",
        refresh: "5m",
        period: "1h",
        theme: "dark",
        fit: "true",
        embed: "true",
      });
    });

    it("builds a page-fallback URL that carries the playlist so the next page continues", () => {
      const query = buildSlideQuery(config(), 1, "page", 2);
      expect(query).toMatchObject({
        dashboard: "d 2",
        folder: "ops:team",
        kiosk: "true",
        playlist: "d1:default,d%202:ops%3Ateam",
        interval: "1m",
        slide: "2",
        tvpage: "1",
        miss: "2",
      });
      expect(query.embed).toBeUndefined();
    });
  });

  it("picks and strips only the playlist params", () => {
    const query = {
      dashboard: "d1",
      playlist: "d1",
      interval: "1m",
      slide: "1",
      embed: "true",
      tvpage: "1",
      miss: "1",
      kiosk: "true",
    };
    expect(pickPlaylistParams(query)).toEqual({
      playlist: "d1",
      interval: "1m",
      slide: "1",
      embed: "true",
      tvpage: "1",
      miss: "1",
    });
    expect(stripPlaylistParams(query)).toEqual({ dashboard: "d1", kiosk: "true" });
  });

  describe("frame messages", () => {
    const source = "o2-tv-playlist";

    it("accepts every well-formed message", () => {
      expect(isPlaylistFrameMessage({ source, type: "hello" })).toBe(true);
      expect(isPlaylistFrameMessage({ source, type: "ready", title: "A" })).toBe(true);
      expect(isPlaylistFrameMessage({ source, type: "missing", reason: "forbidden" })).toBe(true);
      expect(isPlaylistFrameMessage({ source, type: "error" })).toBe(true);
      expect(
        isPlaylistFrameMessage({
          source,
          type: "health",
          health: { level: "warn", failing: 2, outage: false, lastSuccessAt: 1 },
        }),
      ).toBe(true);
    });

    it("rejects foreign or malformed messages", () => {
      expect(isPlaylistFrameMessage(null)).toBe(false);
      expect(isPlaylistFrameMessage("ready")).toBe(false);
      expect(isPlaylistFrameMessage({ type: "hello" })).toBe(false);
      expect(isPlaylistFrameMessage({ source, type: "ready" })).toBe(false);
      expect(isPlaylistFrameMessage({ source, type: "missing", reason: "gone" })).toBe(false);
      expect(isPlaylistFrameMessage({ source, type: "health", health: { level: "x" } })).toBe(
        false,
      );
      expect(isPlaylistFrameMessage({ source, type: "navigate" })).toBe(false);
      expect(isPlaylistFrameMessage({ source, type: "context", context: {} })).toBe(false);
    });
  });

  it("only treats 404 and 403 as a missing dashboard", () => {
    expect(missingReasonFor(404)).toBe("notFound");
    expect(missingReasonFor(403)).toBe("forbidden");
    expect(missingReasonFor(500)).toBeNull();
    expect(missingReasonFor(undefined)).toBeNull();
  });

  it.each([
    [undefined, false],
    ["1m", false],
    ["90", false],
    ["1s", true],
    ["2h", true],
    ["abc", true],
  ])("interval=%s is reported as adjusted: %s", (value, adjusted) => {
    expect(isPlaylistIntervalAdjusted(value)).toBe(adjusted);
  });

  describe("framing headers", () => {
    const origin = "https://o2.example.com";
    const blocked = (headers: Record<string, string>) =>
      isFramingBlocked(new Headers(headers), origin);

    it("allows no header, SAMEORIGIN and frame-ancestors that include this app", () => {
      expect(blocked({})).toBe(false);
      expect(blocked({ "X-Frame-Options": "SAMEORIGIN" })).toBe(false);
      expect(
        blocked({ "Content-Security-Policy": "default-src 'self'; frame-ancestors 'self'" }),
      ).toBe(false);
      expect(blocked({ "Content-Security-Policy": `frame-ancestors ${origin}` })).toBe(false);
      expect(blocked({ "Content-Security-Policy": "default-src 'self'" })).toBe(false);
    });

    it("blocks DENY and frame-ancestors that exclude this app", () => {
      expect(blocked({ "X-Frame-Options": "DENY" })).toBe(true);
      expect(blocked({ "Content-Security-Policy": "frame-ancestors 'none'" })).toBe(true);
      expect(blocked({ "Content-Security-Policy": "frame-ancestors https://other.example" })).toBe(
        true,
      );
    });
  });
});
