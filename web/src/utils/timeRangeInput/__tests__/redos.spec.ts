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

import ts from "typescript";
import { describe, expect, it } from "vitest";

import type { LocalePack } from "../packs/schema";
import { nodeBundle } from "./bundle-helper";
import { runChild } from "./child";

const sources = import.meta.glob<string>(["../**/*.ts", "!../__tests__/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const hands = import.meta.glob<{ pack: LocalePack }>(["../packs/*.ts", "!../packs/schema.ts"], {
  eager: true,
});

interface Atom {
  text: string;
  min: number;
  max: number;
  group?: string;
}

const SAMPLE = [..."abcxyzABZ019 \t-_.:/+?*()[]{}|\\^$", "é", "日", " "];

function parseAtoms(src: string): Atom[] {
  const atoms: Atom[] = [];
  let i = 0;
  while (i < src.length) {
    let text = src[i];
    let group: string | undefined;
    if (src[i] === "\\") text = src.slice(i, i + 2);
    else if (src[i] === "[") {
      let j = i + 1;
      while (j < src.length && src[j] !== "]") j += src[j] === "\\" ? 2 : 1;
      text = src.slice(i, j + 1);
    } else if (src[i] === "(") {
      let depth = 0;
      let j = i;
      for (; j < src.length; j++) {
        if (src[j] === "\\") j++;
        else if (src[j] === "(") depth++;
        else if (src[j] === ")" && --depth === 0) break;
      }
      text = src.slice(i, j + 1);
      group = text.slice(1, -1).replace(/^\?(?:[:=!]|<[=!]?[A-Za-z]*>?)/, "");
    }
    i += text.length;
    let min = 1;
    let max = 1;
    const q = /^(?:\*|\+|\?|\{(\d+)(?:,(\d*))?\})\??/.exec(src.slice(i));
    if (q) {
      if (q[0][0] === "*") [min, max] = [0, Infinity];
      else if (q[0][0] === "+") [min, max] = [1, Infinity];
      else if (q[0][0] === "?") [min, max] = [0, 1];
      else
        [min, max] = [
          Number(q[1]),
          q[2] === undefined ? Number(q[1]) : q[2] === "" ? Infinity : Number(q[2]),
        ];
      i += q[0].length;
    }
    atoms.push({ text, min, max, group });
  }
  return atoms;
}

function chars(atom: Atom): Set<string> {
  if (atom.text === "^" || atom.text === "$") return new Set();
  const re = new RegExp(`^(?:${atom.group ?? atom.text})`, "u");
  return new Set(SAMPLE.filter((c) => re.test(c)));
}

/** Problems with a regex source: unanchored, nested or overlapping-alternation quantifiers, overlapping neighbours. */
export function regexProblems(src: string, flags: string): string[] {
  const out: string[] = [];
  if (!flags.includes("y") && !(src.startsWith("^") && src.endsWith("$") && !src.endsWith("\\$")))
    out.push("unanchored");
  const walk = (s: string): void => {
    const atoms = parseAtoms(s);
    for (let k = 0; k < atoms.length; k++) {
      const a = atoms[k];
      if (a.group !== undefined) {
        const inner = parseAtoms(a.group);
        if (a.max > 1 && inner.some((x) => x.max > 1)) out.push(`nested quantifier ${a.text}`);
        const branches = a.group.split("|");
        if (a.max > 1 && branches.length > 1) {
          const firsts = branches.map((b) =>
            chars(parseAtoms(b)[0] ?? { text: "", min: 1, max: 1 }),
          );
          for (let x = 0; x < firsts.length; x++) {
            for (let y = x + 1; y < firsts.length; y++) {
              if ([...firsts[x]].some((c) => firsts[y].has(c)))
                out.push(`overlapping alternation ${a.text}`);
            }
          }
        }
        walk(a.group);
      }
      const b = atoms[k + 1];
      if (b && a.max > 1 && b.max > 1 && [...chars(a)].some((c) => chars(b).has(c))) {
        out.push(`overlapping neighbours ${a.text}${b.text}`);
      }
    }
  };
  walk(src.replace(/^\^/, "").replace(/\$$/, ""));
  return out;
}

function regexesIn(file: string, source: string): { src: string; flags: string }[] {
  const out: { src: string; flags: string }[] = [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(node)) {
      const text = node.getText();
      const end = text.lastIndexOf("/");
      out.push({ src: text.slice(1, end), flags: text.slice(end + 1) });
    }
    if (ts.isNewExpression(node) && node.expression.getText() === "RegExp") {
      const [first, second] = node.arguments ?? [];
      out.push({
        src: first && ts.isStringLiteral(first) ? first.text : "<dynamic>",
        flags: second?.getText() ?? "",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("regex safety", () => {
  it("flags the banned shapes", () => {
    for (const bad of ["^a*a*b$", "^\\d+\\d*$", "^\\s*\\s+$", "^(a+)+$", "^(a|ab)*$", "abc"]) {
      expect(regexProblems(bad, ""), bad).not.toEqual([]);
    }
    expect(regexProblems("^\\d{4}-\\d{2}$", "")).toEqual([]);
    expect(regexProblems("^\\d+:\\d+$", "")).toEqual([]);
  });

  it("finds no unsafe regex in the parser sources", () => {
    const found = Object.entries(sources).flatMap(([file, source]) =>
      regexesIn(file, source).map((r) => ({ file, ...r, problems: regexProblems(r.src, r.flags) })),
    );
    expect(found.filter((f) => f.problems.length > 0)).toEqual([]);
  });

  it("parses hostile 512-character inputs in a child process within budget", () => {
    const words = Object.fromEntries(
      Object.values(hands).map(({ pack }) => [
        pack.key,
        [
          ...Object.values(pack.units).flatMap((w) => w ?? []),
          ...Object.values(pack.words).flatMap((w) => w ?? []),
          ...Object.keys(pack.numberWords ?? {}),
        ],
      ]),
    );
    const code = `
      const p = await import(${JSON.stringify(nodeBundle())});
      const keys = ["en-us","ar","zh-cn","tr-turk","de","es","fr","it","ja","ko","nl","pt","zh-tw","ru","pl","vi","th"];
      const packs = await Promise.all(keys.map((k) => p.loadTimeRangeLocale(k)));
      const base = { nowUs: 1794916800000000, zone: "Europe/Berlin", units: ["s","m","h","d","w","M"],
        kinds: { relative: true, calendar: true, absolute: true }, limits: { allowFuture: false } };
      const fill = (s, n = 512) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
      const families = ["1", "-", "1-", "0:", "now-", "2026-11-", '{"start_date":', "last ", "最近", " to", " - to ~ ..", "15m ", "[", "9"]
        .map((s) => fill(s)).concat([fill("1", 511) + "x"]);
      // Date math that lands in the Berlin repeated hour again and again, under each step mix.
      const folds = [["now/y+9M+24d+2h", "-1d+1d"], ...["-1d+1d", "+1h-1d+1d", "-1h+1d-1d", "+1M-1M", "+30m-1w+1w",
        "+1y-1y", "+1d-24h"].map((c) => ["now-23d-11h", c]), ["now-23d-11h/h", "+1d-1d"]]
        .map(([pre, cycle]) => pre + cycle.repeat(Math.floor((512 - pre.length) / cycle.length)));
      const words = ${JSON.stringify(words)};
      for (const pack of packs) p.parseTimeRangeInput({ ...base, pack, text: "warm up 15m" });
      let worst = 0, worstText = "";
      const time = (pack, text) => {
        let ms = Infinity;
        for (let k = 0; k < 3; k++) {
          const t = performance.now(); p.parseTimeRangeInput({ ...base, pack, text }); ms = Math.min(ms, performance.now() - t);
        }
        if (ms > worst) { worst = ms; worstText = text.slice(0, 30); }
      };
      for (const text of [...families, ...folds]) for (const pack of packs) time(pack, text);
      for (const [i, key] of keys.entries()) for (const w of words[key] ?? []) time(packs[i], fill(w + " "));
      let a = 20261119;
      const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const hostile = [];
      for (let i = 0; i < 2000; i++) {
        const f = families[Math.floor(rnd() * families.length)];
        const cut = Math.floor(rnd() * 512);
        hostile.push(f.slice(0, cut) + f.slice(cut).split("").reverse().join(""));
      }
      let total = Infinity;
      for (let round = 0; round < 2; round++) {
        const t0 = performance.now();
        hostile.forEach((text, i) => p.parseTimeRangeInput({ ...base, pack: packs[i % packs.length], text }));
        total = Math.min(total, performance.now() - t0);
      }
      process.stdout.write(JSON.stringify({ worst, worstText, total }));
    `;
    const { value } = runChild<{ worst: number; worstText: string; total: number }>(
      code,
      {},
      // The kill only catches a hang; a loaded CI shard can take far longer than the timed work.
      90_000,
    );
    process.stdout.write(
      `hostile worst ${value.worst.toFixed(2)} ms (${value.worstText}), 2000 seeded ${value.total.toFixed(0)} ms\n`,
    );
    expect(value.worst).toBeLessThan(25);
    expect(value.total).toBeLessThan(2000);
  }, 120_000);
});
