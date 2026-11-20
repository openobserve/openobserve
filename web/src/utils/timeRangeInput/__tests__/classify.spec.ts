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

import { parseTimeRangeInput } from "../index";
import type { LocalePack } from "../packs/schema";
import type { TimeRangePack } from "../types";
import { ALL_LOCALES, baseContext, isoUs, packFor } from "./helpers";

const A = "2026-11-16T09:00:00Z";
const B = "2026-11-16T10:00:00Z";
const UNIVERSAL = ["to", "–", "—", "~", "..", " - ", "/"];
const hands = import.meta.glob<{ pack: LocalePack }>(["../packs/*.ts", "!../packs/schema.ts"], {
  eager: true,
});

// The first alternative of each `(a|b)` group gives one concrete spelling of a pattern.
function concrete(pattern: string): string {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "(") {
      const close = pattern.indexOf(")", i);
      out += pattern.slice(i + 1, close).split("|")[0];
      i = close;
    } else out += pattern[i];
  }
  return out;
}

async function packOf(key: string): Promise<TimeRangePack> {
  const locale = Object.entries({ "en-us": "en-US" }).find(([k]) => k === key)?.[1] ?? key;
  return packFor(
    locale === key ? (ALL_LOCALES.includes(key as never) ? keyToCorpus(key) : key) : locale,
  );
}

function keyToCorpus(key: string): string {
  const map: Record<string, string> = {
    ar: "ar-SA",
    "zh-cn": "zh-CN",
    "tr-turk": "tr-TR",
    de: "de-DE",
    es: "es-ES",
    fr: "fr-FR",
    it: "it-IT",
    ja: "ja-JP",
    ko: "ko-KR",
    nl: "nl-NL",
    pt: "pt-PT",
    "zh-tw": "zh-TW",
    ru: "ru-RU",
    pl: "pl-PL",
    vi: "vi-VN",
    th: "th-TH",
  };
  return map[key] ?? "en-US";
}

function expectRange(pack: TimeRangePack, text: string): void {
  const r = parseTimeRangeInput(baseContext(pack, text));
  expect(r.state, `${text}: ${JSON.stringify(r)}`).toBe("valid");
  if (r.state !== "valid") return;
  expect([r.reading.startUs, r.reading.endUs]).toEqual([isoUs(A), isoUs(B)]);
  expect(r.reading.origin.form).toBe("range");
}

describe("classifier precedence", () => {
  for (const [file, mod] of Object.entries(hands)) {
    const hand = mod.pack;
    it(`reads <ISO> join <ISO> as a range for every join and template of ${file}`, async () => {
      const pack = await packOf(hand.key);
      for (const join of [...hand.rangeJoin, ...UNIVERSAL]) {
        expectRange(pack, `${A}${join.startsWith(" ") ? join : ` ${join} `}${B}`);
      }
      for (const t of hand.rangeTemplates)
        expectRange(pack, concrete(t).replace("{start}", A).replace("{end}", B));
    });
  }

  it("reads <ISO> followed by text as a log line, not a range", async () => {
    const pack = await packOf("en-us");
    const r = parseTimeRangeInput(baseContext(pack, `${A} INFO moved to queue`));
    expect(r.state === "valid" && r.reading.origin.form).toBe("log-line");
    if (r.state === "valid")
      expect(r.reading.notes.map((n) => n.kind)).toEqual([
        "converted",
        "instant-window",
        "log-line",
      ]);
  });

  it("asks which stamp when a log line starts with two", async () => {
    const pack = await packOf("en-us");
    const r = parseTimeRangeInput(baseContext(pack, `${A} ${B} worker started`));
    expect(r.state === "ambiguous" && r.reason).toBe("log-stamps");
    expect(r.state === "ambiguous" && r.readings.map((x) => x.origin.form)).toEqual([
      "log-line",
      "log-line",
    ]);
  });

  it("reads copy payloads and URLs strictly", async () => {
    const pack = await packOf("en-us");
    const state = (text: string) => parseTimeRangeInput(baseContext(pack, text));
    const payload = state('{"start_date":1794819600000000,"end_date":1794823200000000}');
    expect(payload.state === "valid" && payload.reading.origin.form).toBe("copy-payload");
    expect(state('{"start_date":1794819600000000,"end_date":1794823200000000,"x":1}').state).toBe(
      "invalid",
    );
    const url = state("https://example.test/logs?from=1794819600000&to=1794823200000");
    expect(url.state === "valid" && url.reading.origin.form).toBe("url");
    expect(state("https://example.test/logs?q=error").state).toBe("invalid");
  });

  it("treats 1-3 digit counts as incomplete and only exact epoch lengths as instants", async () => {
    const pack = await packOf("en-us");
    const state = (text: string) => parseTimeRangeInput(baseContext(pack, text));
    expect(state("15").state).toBe("incomplete");
    for (const text of ["0", "0015", "123456789", "17948196000", "-1234567890"])
      expect(state(text).state, text).toBe("invalid");
    for (const text of ["1794819600", "1794819600123", "1794819600123456", "1794819600123456789"]) {
      const r = state(text);
      expect(r.state === "valid" && r.reading.origin.form, text).toBe("epoch");
    }
    const big = state("9007199254740993");
    expect(big.state === "invalid" && big.reason).toBe("out-of-range");
  });

  it("reads dates and stamps after 2255 as invalid/out-of-range", async () => {
    const pack = await packOf("en-us");
    for (const text of [
      "2260-01-01",
      "2300-06-01T09:00:00Z",
      "2260-01-01 to 2260-01-02",
      "since 2300-01-01",
      "9999-12-31",
    ]) {
      const r = parseTimeRangeInput(baseContext(pack, text));
      expect(r.state === "invalid" && r.reason, text).toBe("out-of-range");
    }
    const ok = parseTimeRangeInput(baseContext(pack, "2255-06-01"));
    expect(ok.state, "2255-06-01 is still representable").toBe("blocked");
  });
});
