// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { MISSING_VALUE_KEY, isNullValue, valueKeyLabel } from "./valueFilterExpression";

describe("valueKeyLabel", () => {
  it("labels the missing value apart from the stored text null", () => {
    expect(valueKeyLabel(MISSING_VALUE_KEY)).toBe("");
    expect(valueKeyLabel(MISSING_VALUE_KEY)).not.toBe("null");
    expect(valueKeyLabel("null")).toBeUndefined();
    expect(valueKeyLabel("")).toBeUndefined();
  });

  it("treats only the missing-value key as null, not the text null", () => {
    expect(isNullValue(MISSING_VALUE_KEY)).toBe(true);
    expect(isNullValue("null")).toBe(false);
  });
});
