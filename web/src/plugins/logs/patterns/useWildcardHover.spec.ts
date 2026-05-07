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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// Must import the composable before resetting fake timers so the module-level
// `hideTimeout` is not touched before tests start.
import useWildcardHover from "./useWildcardHover";

describe("useWildcardHover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("onMouseEnter", () => {
    it("should set hoveredToken with normalized displayValues from string sampleValues", () => {
      const { onMouseEnter, hoveredToken } = useWildcardHover();
      const el = document.createElement("span");

      onMouseEnter("<*>", ["value1", "value2"], { currentTarget: el } as any);

      expect(hoveredToken.value).not.toBeNull();
      expect(hoveredToken.value!.token).toBe("<*>");
      expect(hoveredToken.value!.anchorEl).toBe(el);
      expect(hoveredToken.value!.displayValues).toEqual([
        { value: "value1", count: 0 },
        { value: "value2", count: 0 },
      ]);
    });

    it("should normalize object sampleValues with count", () => {
      const { onMouseEnter, hoveredToken } = useWildcardHover();
      const el = document.createElement("span");

      onMouseEnter("<:IP>", [{ value: "10.0.0.1", count: 42 }], {
        currentTarget: el,
      } as any);

      expect(hoveredToken.value!.displayValues).toEqual([
        { value: "10.0.0.1", count: 42 },
      ]);
    });

    it("should cancel any pending hide timeout", () => {
      const { onMouseEnter, onMouseLeave, hoveredToken } = useWildcardHover();
      const el = document.createElement("span");

      onMouseLeave();
      // Timeout is now pending — onMouseEnter should cancel it
      onMouseEnter("<*>", [], { currentTarget: el } as any);

      expect(hoveredToken.value).not.toBeNull();
    });
  });

  describe("onMouseLeave", () => {
    it("should set hoveredToken to null after 200ms", () => {
      const { onMouseEnter, onMouseLeave, hoveredToken } = useWildcardHover();
      const el = document.createElement("span");

      onMouseEnter("<*>", [], { currentTarget: el } as any);
      expect(hoveredToken.value).not.toBeNull();

      onMouseLeave();
      expect(hoveredToken.value).not.toBeNull(); // still visible

      vi.advanceTimersByTime(200);
      expect(hoveredToken.value).toBeNull();
    });
  });

  describe("onPopoverEnter", () => {
    it("should cancel the pending hide timeout", () => {
      const { onMouseEnter, onMouseLeave, onPopoverEnter, hoveredToken } =
        useWildcardHover();
      const el = document.createElement("span");

      onMouseEnter("<*>", [], { currentTarget: el } as any);
      onMouseLeave(); // starts 200ms timer

      onPopoverEnter(); // cancels the timer

      vi.advanceTimersByTime(200);
      expect(hoveredToken.value).not.toBeNull(); // should still be visible
    });
  });

  describe("onPopoverLeave", () => {
    it("should set hoveredToken to null after 200ms", () => {
      const { onMouseEnter, onPopoverLeave, hoveredToken } = useWildcardHover();
      const el = document.createElement("span");

      onMouseEnter("<*>", [], { currentTarget: el } as any);
      onPopoverLeave();

      vi.advanceTimersByTime(200);
      expect(hoveredToken.value).toBeNull();
    });
  });

  describe("rapid hovers", () => {
    it("should retain the last hovered token after rapid enter/leave", () => {
      const { onMouseEnter, onMouseLeave, hoveredToken } = useWildcardHover();
      const el = document.createElement("span");

      onMouseEnter("<*>", [], { currentTarget: el } as any);
      onMouseLeave();
      onMouseEnter("<:IP>", [], { currentTarget: el } as any);
      onMouseLeave();
      onMouseEnter("<:NUM>", [], { currentTarget: el } as any);

      expect(hoveredToken.value!.token).toBe("<:NUM>");
    });

    it("should dismiss the popover after the final leave timeout", () => {
      const { onMouseEnter, onMouseLeave, hoveredToken } = useWildcardHover();
      const el = document.createElement("span");

      onMouseEnter("<*>", [], { currentTarget: el } as any);
      // Two rapid leave+enter sequences, then a final leave
      onMouseLeave();
      onMouseEnter("<:IP>", [], { currentTarget: el } as any);
      onMouseLeave();
      onMouseEnter("<:NUM>", [], { currentTarget: el } as any);
      onMouseLeave();

      vi.advanceTimersByTime(200);
      expect(hoveredToken.value).toBeNull();
    });
  });

  describe("module-level state isolation", () => {
    it("should share hoveredToken across multiple calls to useWildcardHover()", () => {
      const a = useWildcardHover();
      const b = useWildcardHover();

      // Both should reference the same ref
      expect(a.hoveredToken).toBe(b.hoveredToken);
    });
  });
});
