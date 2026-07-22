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

import { describe, it, expect } from "vitest";
import {
  buildMobileTimeline,
  wireframesAt,
  viewportAt,
  wireframeStyle,
  isMobileReplaySource,
} from "./useMobileSessionReplay";

describe("useMobileSessionReplay", () => {
  describe("buildMobileTimeline", () => {
    it("flattens and sorts records across segments by timestamp", () => {
      const segments = [
        { records: [{ type: 10, timestamp: 200, data: { wireframes: [] } }] },
        { records: [{ type: 4, timestamp: 100, data: { width: 400, height: 800 } }] },
      ];

      const tl = buildMobileTimeline(segments);

      expect(tl.records.map((r) => r.timestamp)).toEqual([100, 200]);
      expect(tl.startTime).toBe(100);
      expect(tl.endTime).toBe(200);
      expect(tl.duration).toBe(100);
    });

    it("returns an empty timeline when there are no records", () => {
      const tl = buildMobileTimeline([]);

      expect(tl.records).toEqual([]);
      expect(tl.duration).toBe(0);
    });

    it("ignores malformed records without a numeric type/timestamp", () => {
      const tl = buildMobileTimeline([
        {
          records: [
            { type: 10 } as any,
            null as any,
            { type: 4, timestamp: 5, data: {} },
          ],
        },
      ]);

      expect(tl.records).toHaveLength(1);
      expect(tl.records[0].timestamp).toBe(5);
    });
  });

  describe("wireframesAt", () => {
    const records = [
      {
        type: 10,
        timestamp: 0,
        data: {
          wireframes: [
            { id: 1, x: 0, y: 0, width: 10, height: 10, type: "shape" },
            { id: 2, x: 0, y: 10, width: 10, height: 10, type: "shape" },
          ],
        },
      },
      {
        type: 11,
        timestamp: 10,
        data: {
          source: 0,
          removes: [{ id: 2 }],
          adds: [
            {
              previousId: 1,
              wireframe: { id: 3, x: 0, y: 20, width: 10, height: 10, type: "text", text: "hi" },
            },
          ],
          updates: [{ id: 1, width: 20 }],
        },
      },
    ];

    it("returns the full-snapshot wireframes before any mutation", () => {
      const wf = wireframesAt(records, 5);

      expect(wf.map((w) => w.id)).toEqual([1, 2]);
    });

    it("applies removes, adds-after-previousId and updates at the incremental", () => {
      const wf = wireframesAt(records, 10);

      expect(wf.map((w) => w.id)).toEqual([1, 3]); // 2 removed; 3 inserted after 1
      expect(wf.find((w) => w.id === 1)?.width).toBe(20); // updated
      expect(wf.find((w) => w.id === 3)?.text).toBe("hi");
    });

    it("returns [] when there is no full snapshot at or before t", () => {
      expect(wireframesAt(records, -1)).toEqual([]);
    });

    it("seeds from the latest full snapshot at or before t", () => {
      const recs = [
        { type: 10, timestamp: 0, data: { wireframes: [{ id: 1, x: 0, y: 0, width: 1, height: 1, type: "shape" }] } },
        { type: 10, timestamp: 100, data: { wireframes: [{ id: 9, x: 0, y: 0, width: 1, height: 1, type: "shape" }] } },
      ];

      expect(wireframesAt(recs, 150).map((w) => w.id)).toEqual([9]);
    });

    it("does not apply mutations after t", () => {
      const wf = wireframesAt(records, 9);

      expect(wf.map((w) => w.id)).toEqual([1, 2]); // incremental at t=10 not applied
    });
  });

  describe("viewportAt", () => {
    const recs = [
      { type: 4, timestamp: 0, data: { width: 400, height: 800 } },
      { type: 4, timestamp: 50, data: { width: 411, height: 914 } },
    ];

    it("returns the latest meta dimensions at or before t", () => {
      expect(viewportAt(recs, 60)).toEqual({ width: 411, height: 914 });
      expect(viewportAt(recs, 10)).toEqual({ width: 400, height: 800 });
    });

    it("returns zeros when there is no meta record", () => {
      expect(viewportAt([], 100)).toEqual({ width: 0, height: 0 });
    });
  });

  describe("wireframeStyle", () => {
    it("positions absolutely with pixel bounds", () => {
      const s = wireframeStyle({ id: 1, x: 5, y: 6, width: 7, height: 8, type: "shape" });

      expect(s.position).toBe("absolute");
      expect(s.left).toBe("5px");
      expect(s.top).toBe("6px");
      expect(s.width).toBe("7px");
      expect(s.height).toBe("8px");
    });

    it("applies shape background, opacity and corner radius", () => {
      const s = wireframeStyle({
        id: 1, x: 0, y: 0, width: 1, height: 1, type: "shape",
        shapeStyle: { backgroundColor: "#fafafaff", opacity: 0.5, cornerRadius: 4 },
      });

      expect(s["background-color"]).toBe("#fafafaff");
      expect(s.opacity).toBe("0.5");
      expect(s["border-radius"]).toBe("4px");
    });

    it("applies text font styles", () => {
      const s = wireframeStyle({
        id: 1, x: 0, y: 0, width: 1, height: 1, type: "text",
        textStyle: { color: "#1c1c1eff", size: 20, family: "roboto" },
      });

      expect(s.color).toBe("#1c1c1eff");
      expect(s["font-size"]).toBe("20px");
      expect(s["font-family"]).toBe("roboto");
    });
  });

  describe("isMobileReplaySource", () => {
    it("is true for mobile sources", () => {
      expect(isMobileReplaySource("react-native")).toBe(true);
      expect(isMobileReplaySource("ios")).toBe(true);
      expect(isMobileReplaySource("android")).toBe(true);
    });

    it("is false for browser, empty or undefined", () => {
      expect(isMobileReplaySource("browser")).toBe(false);
      expect(isMobileReplaySource("")).toBe(false);
      expect(isMobileReplaySource(undefined)).toBe(false);
    });
  });
});
