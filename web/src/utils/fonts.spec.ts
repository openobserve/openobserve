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

import { beforeEach, describe, expect, it } from "vitest";
import { __resetFontCache, getFontSans, withChartFont } from "./fonts";

const text = (style: Record<string, unknown> = {}) => ({
  type: "text",
  style: { text: "5", ...style },
});

describe("withChartFont", () => {
  beforeEach(() => __resetFontCache());

  it("sets the sans family as the default text style and keeps a chart's own family", () => {
    expect(withChartFont({}).textStyle).toEqual({ fontFamily: getFontSans() });
    expect(withChartFont({ textStyle: { fontFamily: "Geist Mono" } }).textStyle.fontFamily).toBe(
      "Geist Mono",
    );
  });

  it("stamps the family on graphic text, including nested group children", () => {
    const out = withChartFont({
      graphic: [text(), { type: "group", children: [text(), { type: "rect", style: {} }] }],
    });
    expect(out.graphic[0].style.fontFamily).toBe(getFontSans());
    expect(out.graphic[1].children[0].style.fontFamily).toBe(getFontSans());
    expect(out.graphic[1].children[1].style.fontFamily).toBeUndefined();
  });

  it("handles the graphic `elements` form and leaves an explicit family or font alone", () => {
    const out = withChartFont({
      graphic: { elements: [text({ fontFamily: "Geist Mono" }), text({ font: "12px serif" })] },
    });
    expect(out.graphic.elements[0].style.fontFamily).toBe("Geist Mono");
    expect(out.graphic.elements[1].style.fontFamily).toBeUndefined();
  });

  it("wraps a custom series renderItem so the text it returns uses the family", () => {
    const line = { type: "line", data: [1] };
    const out = withChartFont({
      series: [{ type: "custom", renderItem: () => text({ fontSize: 31 }) }, line],
    });
    const rendered = out.series[0].renderItem();
    expect(rendered.style).toEqual({ text: "5", fontSize: 31, fontFamily: getFontSans() });
    expect(out.series[1]).toBe(line);
  });

  it("never mutates the options it is given", () => {
    const graphic = [text()];
    const options = { graphic, series: { type: "custom", renderItem: () => text() } };
    const out = withChartFont(options);
    expect(out).not.toBe(options);
    expect(graphic[0].style).not.toHaveProperty("fontFamily");
    expect(options.series.renderItem().style).not.toHaveProperty("fontFamily");
  });
});
