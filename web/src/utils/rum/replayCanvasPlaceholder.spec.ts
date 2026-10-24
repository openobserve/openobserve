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

import { buildReplayCanvasPlaceholderRule } from "./replayCanvasPlaceholder";

const decodeSvg = (rule: string) => {
  const encoded = /url\("data:image\/svg\+xml,([^"]*)"\)/.exec(rule)?.[1] ?? "";
  return decodeURIComponent(encoded);
};

describe("buildReplayCanvasPlaceholderRule", () => {
  it("targets canvas elements with a single rule", () => {
    const rule = buildReplayCanvasPlaceholderRule("Canvas content not recorded");
    expect(rule.startsWith("canvas {")).toBe(true);
    expect(rule.match(/\{/g)).toHaveLength(1);
  });

  it("carries the label in an encoded SVG data URI", () => {
    const rule = buildReplayCanvasPlaceholderRule("Canvas content not recorded");
    expect(rule).toContain(encodeURIComponent("Canvas content not recorded"));
    expect(rule).not.toContain("Canvas content not recorded");
    expect(decodeSvg(rule)).toContain(">Canvas content not recorded</text>");
  });

  it("escapes markup characters in the label", () => {
    const rule = buildReplayCanvasPlaceholderRule(`<b>"A" & 'B'</b>`);
    const svg = decodeSvg(rule);
    expect(svg).toContain("&lt;b&gt;&quot;A&quot; &amp; &apos;B&apos;&lt;/b&gt;");
    expect(svg).not.toContain("<b>");
  });

  it("marks every declaration important and keeps the fill translucent", () => {
    const rule = buildReplayCanvasPlaceholderRule("x");
    const body = rule.slice(rule.indexOf("{") + 1, rule.lastIndexOf("}"));
    const declarations = body
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean);
    expect(declarations.length).toBeGreaterThan(0);
    for (const declaration of declarations) expect(declaration).toContain("!important");
    expect(rule).toContain("background-color: rgba(128,128,128,0.08) !important");
    expect(rule).toContain("repeating-linear-gradient");
    expect(rule).toContain("outline: 1px dashed");
  });

  it("does not rely on pseudo-elements, which a canvas does not render", () => {
    const rule = buildReplayCanvasPlaceholderRule("x");
    expect(rule).not.toContain("::after");
    expect(rule).not.toContain("::before");
  });
});
