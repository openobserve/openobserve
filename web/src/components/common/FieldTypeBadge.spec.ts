// Copyright 2023 OpenObserve Inc.
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

import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import FieldTypeBadge from "@/components/common/FieldTypeBadge.vue";

describe("FieldTypeBadge.vue", () => {
  const createWrapper = (props: Record<string, any> = {}) =>
    mount(FieldTypeBadge, { props });

  // ─── Rendering ───────────────────────────────────────────────────────────────

  describe("Rendering", () => {
    it("does not render when dataType is undefined", () => {
      const wrapper = createWrapper();
      expect(wrapper.find(".field-type-badge").exists()).toBe(false);
    });

    it("does not render when dataType is empty string", () => {
      const wrapper = createWrapper({ dataType: "" });
      expect(wrapper.find(".field-type-badge").exists()).toBe(false);
    });

    it("renders a badge when dataType is provided", () => {
      const wrapper = createWrapper({ dataType: "string" });
      expect(wrapper.find(".field-type-badge").exists()).toBe(true);
    });

    it("sets title attribute to the raw dataType value", () => {
      const wrapper = createWrapper({ dataType: "int64" });
      expect(wrapper.find(".field-type-badge").attributes("title")).toBe("int64");
    });
  });

  // ─── Boolean ─────────────────────────────────────────────────────────────────

  describe("Boolean type", () => {
    it("shows label 'B' for boolean", () => {
      const wrapper = createWrapper({ dataType: "boolean" });
      expect(wrapper.find(".field-type-badge").text()).toBe("B");
    });

    it("is case-insensitive for BOOLEAN", () => {
      const wrapper = createWrapper({ dataType: "BOOLEAN" });
      expect(wrapper.find(".field-type-badge").text()).toBe("B");
    });

    it("uses boolean CSS variable for background color", () => {
      const wrapper = createWrapper({ dataType: "boolean" });
      const style = wrapper.find(".field-type-badge").attributes("style") ?? "";
      expect(style).toContain("o2-field-type-boolean-bg");
    });
  });

  // ─── Float ───────────────────────────────────────────────────────────────────

  describe("Float type", () => {
    it("shows label '~' for float64", () => {
      expect(createWrapper({ dataType: "float64" }).find(".field-type-badge").text()).toBe("~");
    });

    it("shows label '~' for float32", () => {
      expect(createWrapper({ dataType: "float32" }).find(".field-type-badge").text()).toBe("~");
    });

    it("shows label '~' for FLOAT (uppercase)", () => {
      expect(createWrapper({ dataType: "FLOAT" }).find(".field-type-badge").text()).toBe("~");
    });

    it("uses float CSS variable for background color", () => {
      const style = createWrapper({ dataType: "float64" })
        .find(".field-type-badge")
        .attributes("style") ?? "";
      expect(style).toContain("o2-field-type-float-bg");
    });
  });

  // ─── Integer / UInt ──────────────────────────────────────────────────────────

  describe("Integer / UInt types", () => {
    const intTypes = ["int8", "int16", "int32", "int64", "uint8", "uint16", "uint32", "uint64"];

    intTypes.forEach((t) => {
      it(`shows label '#' for ${t}`, () => {
        expect(createWrapper({ dataType: t }).find(".field-type-badge").text()).toBe("#");
      });
    });

    it("uses number CSS variable for background color", () => {
      const style = createWrapper({ dataType: "int32" })
        .find(".field-type-badge")
        .attributes("style") ?? "";
      expect(style).toContain("o2-field-type-number-bg");
    });
  });

  // ─── Timestamp / Date ────────────────────────────────────────────────────────

  describe("Timestamp / Date types", () => {
    const tsTypes = ["timestamp", "date32", "date64", "date"];

    tsTypes.forEach((t) => {
      it(`shows label 'T' for ${t}`, () => {
        expect(createWrapper({ dataType: t }).find(".field-type-badge").text()).toBe("T");
      });
    });

    it("shows label 'T' for TIMESTAMP (uppercase)", () => {
      expect(createWrapper({ dataType: "TIMESTAMP" }).find(".field-type-badge").text()).toBe("T");
    });

    it("uses timestamp CSS variable for background color", () => {
      const style = createWrapper({ dataType: "timestamp" })
        .find(".field-type-badge")
        .attributes("style") ?? "";
      expect(style).toContain("o2-field-type-timestamp-bg");
    });
  });

  // ─── String (default) ────────────────────────────────────────────────────────

  describe("String type (default)", () => {
    it("shows label 'S' for string", () => {
      expect(createWrapper({ dataType: "string" }).find(".field-type-badge").text()).toBe("S");
    });

    it("shows label 'S' for utf8", () => {
      expect(createWrapper({ dataType: "utf8" }).find(".field-type-badge").text()).toBe("S");
    });

    it("shows label 'S' for unknown / unsupported types", () => {
      expect(createWrapper({ dataType: "customtype" }).find(".field-type-badge").text()).toBe("S");
    });

    it("uses string CSS variable for background color", () => {
      const style = createWrapper({ dataType: "string" })
        .find(".field-type-badge")
        .attributes("style") ?? "";
      expect(style).toContain("o2-field-type-string-bg");
    });
  });

  // ─── Computed `info` property ────────────────────────────────────────────────

  describe("Computed `info` property", () => {
    it("returns null when dataType is empty", () => {
      const wrapper = createWrapper({ dataType: "" });
      expect((wrapper.vm as any).info).toBeNull();
    });

    it("returns object with label, color, and textColor for valid type", () => {
      const wrapper = createWrapper({ dataType: "boolean" });
      const info = (wrapper.vm as any).info;
      expect(info).not.toBeNull();
      expect(info).toHaveProperty("label");
      expect(info).toHaveProperty("color");
      expect(info).toHaveProperty("textColor");
    });

    it("info.label is 'B' for boolean", () => {
      expect((createWrapper({ dataType: "boolean" }).vm as any).info.label).toBe("B");
    });

    it("info.label is '~' for float", () => {
      expect((createWrapper({ dataType: "float64" }).vm as any).info.label).toBe("~");
    });

    it("info.label is '#' for int", () => {
      expect((createWrapper({ dataType: "int32" }).vm as any).info.label).toBe("#");
    });

    it("info.label is 'T' for timestamp", () => {
      expect((createWrapper({ dataType: "timestamp" }).vm as any).info.label).toBe("T");
    });

    it("info.label is 'S' for string", () => {
      expect((createWrapper({ dataType: "string" }).vm as any).info.label).toBe("S");
    });
  });

  // ─── Inline style binding ────────────────────────────────────────────────────

  describe("Inline style binding", () => {
    it("applies both backgroundColor and color style properties", () => {
      const wrapper = createWrapper({ dataType: "string" });
      const style = wrapper.find(".field-type-badge").attributes("style") ?? "";
      expect(style).toContain("background-color");
      expect(style).toContain("color");
    });
  });
});