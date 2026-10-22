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
import { generateLabelFromName, getAxisLabel, getFieldLabel } from "./fieldLabel";

const builderField = (field: string, label = "") => ({
  label,
  alias: "y_axis_1",
  functionName: "count",
  args: [{ type: "field", value: { field } }],
});

describe("generateLabelFromName", () => {
  it.each([
    ["_timestamp", "Timestamp"],
    ["small_value", "Small Value"],
    ["k8s.pod-name", "K8s Pod Name"],
  ])("turns %s into %s", (name, label) => {
    expect(generateLabelFromName(name)).toBe(label);
  });
});

describe("getFieldLabel", () => {
  const off = { axis_label_mode: "auto" };

  it("uses the typed label", () => {
    expect(getFieldLabel(builderField("fraction", "Ratio"), off)).toBe("Ratio");
  });

  it("generates the label from the field for a blank builder field", () => {
    expect(getFieldLabel(builderField("small_value"), off)).toBe("Small Value");
  });

  it("finds the field inside a nested function", () => {
    const field = {
      label: "",
      alias: "y_axis_1",
      args: [{ type: "function", value: { args: [{ type: "field", value: { field: "cost" } }] } }],
    };
    expect(getFieldLabel(field, off)).toBe("Cost");
  });

  it("falls back to the column, then the alias", () => {
    expect(getFieldLabel({ label: "", alias: "x_axis_1", column: "_timestamp" }, off)).toBe(
      "Timestamp",
    );
    expect(getFieldLabel({ label: "", alias: "x_axis_1" }, off)).toBe("x_axis_1");
  });

  it("names a raw field by its expression, since switching to raw clears its args", () => {
    const raw = (column?: string) => ({
      label: "",
      alias: "y_axis_2",
      column,
      type: "raw",
      rawQuery: "max(fraction) * 100",
      args: [{ type: "field", value: {} }],
    });
    expect(getFieldLabel(raw(), off)).toBe("max(fraction) * 100");
    expect(getFieldLabel(raw("_timestamp"), off)).toBe("max(fraction) * 100");
  });

  it("uses the alias as written for a custom SQL field", () => {
    expect(getFieldLabel(builderField("total_requests"), off, true)).toBe("y_axis_1");
  });

  it("keeps a blank label blank on a panel saved before the mode existed", () => {
    expect(getFieldLabel(builderField("fraction"), {})).toBe("");
    expect(getFieldLabel(builderField("fraction"), undefined)).toBe("");
  });

  it("returns undefined for a missing field", () => {
    expect(getFieldLabel(undefined, off)).toBeUndefined();
  });
});

describe("getAxisLabel", () => {
  it("auto shows a typed label and nothing for a blank one", () => {
    const auto = { axis_label_mode: "auto" };
    expect(getAxisLabel(builderField("fraction", "Ratio"), auto)).toBe("Ratio");
    expect(getAxisLabel(builderField("fraction"), auto)).toBe("");
  });

  it("show also labels an axis only with a typed label, never a generated one", () => {
    const show = { axis_label_mode: "show" };
    expect(getAxisLabel(builderField("fraction", "Ratio"), show)).toBe("Ratio");
    expect(getAxisLabel(builderField("fraction"), show)).toBe("");
  });

  it("hide never shows a label, even a typed one", () => {
    expect(getAxisLabel(builderField("fraction", "Ratio"), { axis_label_mode: "hide" })).toBe("");
  });

  it("shows only the stored label on a panel saved before the mode existed", () => {
    expect(getAxisLabel(builderField("fraction", "Ratio"), {})).toBe("Ratio");
    expect(getAxisLabel(builderField("fraction"), {})).toBe("");
  });
});
