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
import { canLabel, fitLabel, fitLabels, type MeasureText } from "./hexLabel";

// The canvas-less fallback CoverageHexMap uses, so widths are deterministic.
const measure: MeasureText = (text, font) => text.length * font * 0.6;

const SQRT3 = Math.sqrt(3);
// CoverageHexMap's own geometry: hex width W gives radius (W - gap) / sqrt(3).
const hex = (width: number) => {
  const r = (width - 4) / SQRT3;
  return { room: 0.74 * SQRT3 * r, height: r, font: Math.min(12, 0.24 * r) };
};
// The widest hex (MAX_W) and the narrowest one that still gets a label.
const LARGEST = hex(96);
const SMALLEST = hex(48);

const fit = (name: string, size = LARGEST) =>
  fitLabel(name, size.room, size.height, size.font, measure);

const visible = (line: string) => line.replace(/[-_…\s·]/g, "").length;

const NAMES = [
  "svc-e",
  "svc-ingest-b",
  "checkout",
  "a-b-c-d-e",
  "payments-gateway-authorisation-service-a",
];

describe("hex labels never leave a stub line (demo bug 7)", () => {
  it("both sizes are the labelled extremes of the map", () => {
    expect(canLabel(SMALLEST.room, measure)).toBe(true);
    expect(canLabel(hex(44).room, measure)).toBe(false);
  });

  for (const [label, size] of [
    ["largest", LARGEST],
    ["smallest", SMALLEST],
  ] as const) {
    it.each(NAMES)(`keeps 3 characters on every wrapped line of %s at the ${label} hex`, (name) => {
      const out = fit(name, size);
      expect(out).not.toBeNull();
      if (out!.lines.length > 1)
        for (const line of out!.lines) expect(visible(line)).toBeGreaterThanOrEqual(3);
    });
  }

  it("keeps svc-e on one line when only 'svc-' would fit the width", () => {
    const room = measure("svc-", 12) + 1;
    const out = fitLabel("svc-e", room, 60, 12, measure);
    expect(out?.lines).toHaveLength(1);
    expect(out?.lines[0]).not.toBe("svc-");
  });

  it("still wraps at a separator when both lines keep 3 characters", () => {
    const room = measure("ingest-b", 12) + 1;
    expect(fitLabel("svc-ingest-b", room, 60, 12, measure)?.lines).toEqual(["svc-", "ingest-b"]);
  });

  it("never splits the trailing single letter off a long name", () => {
    const name = "payments-gateway-authorisation-service-a";
    expect(name).toHaveLength(40);
    for (const size of [LARGEST, SMALLEST]) {
      const lines = fit(name, size)?.lines ?? [];
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.at(-1)).not.toBe("a");
      expect(lines.every((line) => visible(line) >= 3)).toBe(true);
    }
  });

  it("leaves a name with no separator on one line", () => {
    expect(fit("checkout")?.lines).toEqual(["checkout"]);
    expect(fit("checkout", SMALLEST)?.lines).toHaveLength(1);
  });

  it("keeps a run of one-letter parts on one line, shrunk or cut", () => {
    const out = fit("a-b-c-d-e", SMALLEST);
    expect(out?.lines).toHaveLength(1);
  });
});

// L4's labels join name and place with " · "; m1 draws the name over its place.
describe("hex labels of a name and its place", () => {
  it("breaks between the name and its place before any hyphen", () => {
    const room = measure("cluster-c · ns-j", 10) + 1;
    expect(fitLabel("svc-y · cluster-c · ns-j", room, 60, 10, measure)?.lines).toEqual([
      "svc-y",
      "cluster-c · ns-j",
    ]);
    expect(
      fitLabel("svc-a · no namespace", measure("no namespace", 10) + 1, 60, 10, measure)?.lines,
    ).toEqual(["svc-a", "no namespace"]);
  });

  it("never starts or ends a line on the joiner", () => {
    for (const size of [LARGEST, SMALLEST])
      for (const name of ["svc-y · cluster-c · ns-j", "svc-d · no namespace", "svc-b · ns-a"]) {
        const lines = fit(name, size)?.lines ?? [];
        for (const line of lines) expect(line).not.toMatch(/^\s*·|·\s*$/);
        if (lines.length > 1)
          for (const line of lines) expect(visible(line)).toBeGreaterThanOrEqual(3);
      }
  });

  it("keeps a plain name on one line when it fits", () => {
    expect(fit("svc-b · ns-a")?.lines.join(" ")).toContain("svc-b");
    expect(fit("checkout")?.lines).toEqual(["checkout"]);
  });
});

describe("a crowded map's long labels", () => {
  it("cuts a place rather than splitting it at a hyphen", () => {
    const room = measure("svc-6-e", 9) + 1;
    const lines = fitLabel("svc-6-e · cluster-c · no namespace", room, 40, 9, measure)?.lines ?? [];
    expect(lines[0]).toBe("svc-6-e");
    expect(lines.length).toBeGreaterThan(1);
    // Each later line is the start of a whole place, never the "c" a hyphen split leaves.
    for (const line of lines.slice(1))
      expect(
        ["cluster-c · no namespace", "cluster-c", "no namespace"].some((place) =>
          place.startsWith(line.replace("…", "")),
        ),
      ).toBe(true);
  });
});

describe("label sizes stay on the type scale (T5-5)", () => {
  it("steps down one whole size, never to 10.5", () => {
    const room = measure("checkout-v2", 11) + 1;
    expect(fitLabel("checkout-v2", room, 60, 12, measure)?.font).toBe(11);
  });

  it("snaps a hex-sized font to a whole size", () => {
    const out = fitLabel("api", 200, 60, 11.6, measure);
    expect(out?.font).toBe(11);
  });

  it("shrinks a label that does not fit by one whole size only", () => {
    const out = fitLabel("a-very-long-service-name", 30, 60, 12, measure);
    expect(out?.font).toBe(11);
  });
});

describe("fitLabels: one font size per map (T5-5)", () => {
  it("draws every label at the size the tightest one needs", () => {
    const names = ["svc-j", "svc-b · no namespace", "payments", "svc-ingest-c"];
    const alone = names.map((n) => fit(n)!.font);
    expect(new Set(alone).size).toBeGreaterThan(1);
    const labels = fitLabels(names, LARGEST.room, LARGEST.height, LARGEST.font, measure);
    expect(new Set(labels.map((l) => l!.font)).size).toBe(1);
    expect(labels[0]!.font).toBe(Math.min(...alone));
    expect(labels[0]!.lines).toEqual(["svc-j"]);
  });

  it("keeps the natural size when every label fits it", () => {
    const labels = fitLabels(
      ["svc-j", "payments"],
      LARGEST.room,
      LARGEST.height,
      LARGEST.font,
      measure,
    );
    expect(labels.map((l) => l!.font)).toEqual([fit("svc-j")!.font, fit("payments")!.font]);
  });
});
