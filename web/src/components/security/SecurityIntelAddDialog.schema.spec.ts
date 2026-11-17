// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { intelAddDefaults, makeIntelAddSchema } from "./SecurityIntelAddDialog.schema";

const t = (key: string, named?: Record<string, unknown>) =>
  named ? `${key} ${JSON.stringify(named)}` : key;
const schema = makeIntelAddSchema(t);

describe("intel add schema", () => {
  it("accepts a paste with a list name", () => {
    const value = { ...intelAddDefaults("ioc_manual"), indicators: "10.0.0.1\n10.0.0.2" };
    expect(schema.safeParse(value).success).toBe(true);
  });

  it("needs indicators and a list name", () => {
    const issues = schema.safeParse({ ...intelAddDefaults("  "), indicators: "" }).error!.issues;
    expect(issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(["list", "indicators"]));
  });

  it("keeps confidence within 0 to 100", () => {
    const value = { ...intelAddDefaults("ioc_manual"), indicators: "1.2.3.4", confidence: "150" };
    expect(schema.safeParse(value).success).toBe(false);
  });
});
