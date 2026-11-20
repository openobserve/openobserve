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

// The parser bundled with Vite runs in separate node processes under five TZ values.
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { nodeBundle } from "./bundle-helper";
import { runChild } from "./child";

const FIXTURE = join(__dirname, "../__fixtures__/corpus.json");
const ZONES: [string, number][] = [
  ["UTC", 0],
  ["Asia/Kolkata", -330],
  ["America/Los_Angeles", 480],
  ["Australia/Lord_Howe", -660],
  ["Pacific/Apia", -780],
];

function script(bundle: string, language: string, expectOffset: number): string {
  return `
    import { readFileSync } from "node:fs";
    const p = await import(${JSON.stringify(bundle)});
    const offset = new Date(2026, 0, 1).getTimezoneOffset();
    if (offset !== ${expectOffset}) throw new Error("TZ not applied: " + offset);
    Object.defineProperty(globalThis, "navigator", { value: { language: ${JSON.stringify(language)} }, configurable: true });
    let a = 20261119;
    const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const keys = { "und": "en-us", "en-US": "en-us", "ar-SA": "ar", "zh-CN": "zh-cn", "tr-TR": "tr-turk", "de-DE": "de",
      "es-ES": "es", "fr-FR": "fr", "it-IT": "it", "ja-JP": "ja", "ko-KR": "ko", "nl-NL": "nl", "pt-PT": "pt",
      "zh-TW": "zh-tw", "ru-RU": "ru", "pl-PL": "pl", "vi-VN": "vi", "th-TH": "th" };
    const iso = (s) => { const m = /^(.{19})(?:\\.(\\d+))?(Z|[+-]\\d\\d:\\d\\d)$/.exec(s);
      return Date.parse(m[1] + m[3]) * 1000 + Number((m[2] ?? "").padEnd(6, "0").slice(0, 6)); };
    const rows = JSON.parse(readFileSync(${JSON.stringify(FIXTURE)}, "utf8"));
    const out = [];
    const base = { units: ["s", "m", "h", "d", "w", "M"], kinds: { relative: true, calendar: true, absolute: true }, limits: { allowFuture: false } };
    for (const row of rows) {
      const pack = await p.loadTimeRangeLocale(keys[row.locale] ?? "en-us");
      const text = row.input ?? row.input_gen.parts.map((x) => x.text.repeat(x.repeat)).join("");
      out.push(p.parseTimeRangeInput({ ...base, text, nowUs: iso(row.now), zone: row.zone, pack }));
    }
    const alphabet = ["last ", "15", "m", "h", " to ", "-", ":", "2026-11-16", "T09:00", "Z", "yesterday", "gestern",
      "昨日", "前", "١٥", "๑๕", "１５", "ｍ", "now", "/d", " ", "あ", "\\u0301", "\\ud83d\\ude00", "\\ud800", "IST", "Uhr"];
    const locales = Object.values(keys);
    for (let i = 0; i < 2000; i++) {
      let text = "";
      const n = Math.floor(rnd() * 8);
      for (let j = 0; j < n; j++) text += alphabet[Math.floor(rnd() * alphabet.length)];
      const pack = await p.loadTimeRangeLocale(locales[Math.floor(rnd() * locales.length)]);
      out.push(p.parseTimeRangeInput({ ...base, text, nowUs: 1794916800000000, zone: "Europe/Berlin", pack }));
    }
    process.stdout.write(JSON.stringify(out));
  `;
}

describe("browser zone and language invariance", () => {
  it("gives identical results under five TZ values and three languages", () => {
    const bundle = nodeBundle();
    const runs: string[] = [];
    for (const [tz, offset] of ZONES) {
      runs.push(
        JSON.stringify(
          runChild<unknown>(script(bundle, "en-US", offset), { TZ: tz }, 120_000).value,
        ),
      );
    }
    for (const language of ["de-DE", "ja-JP"]) {
      runs.push(
        JSON.stringify(
          runChild<unknown>(script(bundle, language, 0), { TZ: "UTC" }, 120_000).value,
        ),
      );
    }
    expect(runs[0].length).toBeGreaterThan(1000);
    for (const r of runs.slice(1)) expect(r).toBe(runs[0]);
  }, 600_000);
});
