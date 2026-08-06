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
  EMPTY_CONFIG,
  EXAMPLE_CONFIG,
  parseBannerConfig,
  previewBannersFrom,
  stripJsonComments,
} from "./announcementConfig";

describe("parseBannerConfig", () => {
  it("treats an emptied editor as no banners", () => {
    // Clearing the editor is how an operator takes every banner down; it must
    // not read as a broken document.
    expect(parseBannerConfig("")).toEqual({ ok: true, payload: { banners: [] } });
  });

  it("treats a whitespace-only editor the same way", () => {
    expect(parseBannerConfig("  \n\t\n ")).toEqual({ ok: true, payload: { banners: [] } });
  });

  it("passes a valid document through untouched", () => {
    const parsed = parseBannerConfig('{"banners":[{"message":"Maintenance","variant":"warning"}]}');

    expect(parsed).toEqual({
      ok: true,
      payload: { banners: [{ message: "Maintenance", variant: "warning" }] },
    });
  });

  it("accepts an explicitly empty list", () => {
    expect(parseBannerConfig(EMPTY_CONFIG)).toEqual({ ok: true, payload: { banners: [] } });
  });

  it("rejects malformed JSON", () => {
    expect(parseBannerConfig('{"banners": [')).toEqual({ ok: false });
    expect(parseBannerConfig("not json at all")).toEqual({ ok: false });
  });

  it("leaves schema validation to the server", () => {
    // Well-formed JSON that the server will reject: still `ok` here, because the
    // client only decides whether it can be sent at all.
    expect(parseBannerConfig('{"banners":[{"no_message":true}]}').ok).toBe(true);
  });
});

describe("stripJsonComments", () => {
  it("removes line and block comments", () => {
    expect(stripJsonComments('{ // note\n "a": 1 }').replace(/\s+/g, "")).toBe('{"a":1}');
    expect(stripJsonComments('{ /* note */ "a": 1 }').replace(/\s+/g, "")).toBe('{"a":1}');
  });

  it("leaves URLs alone", () => {
    // Every CTA in this config holds an https:// URL; a naive strip cuts it to
    // "https:" and the banner links nowhere.
    const parsed = JSON.parse(stripJsonComments('{"url": "https://status.example.com/a//b"}'));

    expect(parsed.url).toBe("https://status.example.com/a//b");
  });

  it("does not treat an escaped quote as the end of a string", () => {
    const parsed = JSON.parse(stripJsonComments('{"a": "say \\"//\\" here", "b": 2}'));

    expect(parsed).toEqual({ a: 'say "//" here', b: 2 });
  });

  it("keeps line structure so a parse error still points at the right line", () => {
    expect(stripJsonComments('{\n// gone\n"a": 1\n}').split("\n").length).toBe(4);
  });
});

describe("previewBannersFrom", () => {
  it("previews the banners in the buffer", () => {
    const banners = previewBannersFrom('{"banners":[{"message":"Preview me","variant":"info"}]}');

    expect(banners).toEqual([{ message: "Preview me", variant: "info" }]);
  });

  it("previews nothing while the buffer is mid-edit", () => {
    expect(previewBannersFrom('{"banners":[{"message":')).toEqual([]);
    expect(previewBannersFrom("")).toEqual([]);
  });

  it("skips entries with no message, which have nothing to render", () => {
    const banners = previewBannersFrom('{"banners":[{"variant":"info"},{"message":"Shown"}]}');

    expect(banners).toEqual([{ message: "Shown" }]);
  });
});

describe("EXAMPLE_CONFIG", () => {
  it("is valid, and every banner in it would save", () => {
    const parsed = parseBannerConfig(EXAMPLE_CONFIG);

    expect(parsed.ok).toBe(true);
    const banners = (parsed as { ok: true; payload: any }).payload.banners;
    expect(banners.length).toBeGreaterThan(0);
    expect(banners.every((b: { message?: string }) => !!b.message)).toBe(true);
  });

  it("annotates every field it uses, inline", () => {
    // The annotations are the point of the example — it is the only schema
    // reference in the drawer, and one you have to look up elsewhere is one
    // nobody reads while editing. Asserted structurally rather than on wording,
    // so the comments stay free to be reworded.
    const lines = EXAMPLE_CONFIG.split("\n");

    for (const field of [
      "message",
      "variant",
      "starts_at",
      "ends_at",
      "duration",
      "dismissible",
      "cta",
      "orgs",
      "id",
    ]) {
      const at = lines.findIndex((line) => line.trim().startsWith(`"${field}":`));
      expect(at, `example never uses ${field}`).toBeGreaterThan(0);

      // Walk back over any continuation lines of a multi-line comment.
      const annotated = lines
        .slice(0, at)
        .reverse()
        .find((line) => line.trim())
        ?.trim()
        .startsWith("//");
      expect(annotated, `${field} is not annotated`).toBe(true);
    }
  });

  it("demonstrates both ways of scheduling, so neither has to be guessed", () => {
    const banners = previewBannersFrom(EXAMPLE_CONFIG) as any[];
    const raw = JSON.parse(stripJsonComments(EXAMPLE_CONFIG)).banners;

    expect(banners.length).toBe(raw.length);
    expect(raw.some((b: any) => b.starts_at && b.ends_at)).toBe(true);
    expect(raw.some((b: any) => b.duration)).toBe(true);
    expect(raw.some((b: any) => b.orgs?.length)).toBe(true);
  });
});
