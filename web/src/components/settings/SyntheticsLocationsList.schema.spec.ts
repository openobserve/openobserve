// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { makeSyntheticsLocationFormSchema } from "./SyntheticsLocationsList.schema";

const t = (key: string) => key;

const schema = makeSyntheticsLocationFormSchema(t);

describe("makeSyntheticsLocationFormSchema", () => {
  // ---------------------------------------------------------------------------
  // 1. Complete valid payload with a predefined (non-custom) provider
  // ---------------------------------------------------------------------------
  it("accepts a complete valid payload with a predefined provider", () => {
    const result = schema.safeParse({
      provider: "aws",
      region: "us-east-1",
      label: "AWS US East",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("aws");
      expect(result.data.region).toBe("us-east-1");
      expect(result.data.label).toBe("AWS US East");
      expect(result.data.enabled).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Valid payload with custom provider + customProvider filled
  // ---------------------------------------------------------------------------
  it("accepts a valid payload with custom provider and customProvider filled", () => {
    const result = schema.safeParse({
      provider: "custom",
      customProvider: "DigitalOcean",
      region: "nyc3",
      label: "DO New York",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("custom");
      expect(result.data.customProvider).toBe("DigitalOcean");
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Rejects missing provider (not in enum)
  // ---------------------------------------------------------------------------
  it("rejects a payload when provider is not in the allowed enum", () => {
    const result = schema.safeParse({
      provider: "foobar",
      region: "us-east-1",
      label: "Invalid Provider",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a payload when provider is missing entirely", () => {
    const result = schema.safeParse({
      region: "us-east-1",
      label: "Missing Provider",
    });

    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 4. Rejects empty region
  // ---------------------------------------------------------------------------
  it("rejects a payload when region is empty", () => {
    const result = schema.safeParse({
      provider: "aws",
      region: "",
      label: "AWS US East",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.path.join("."));
      expect(issues).toContain("region");
    }
  });

  it("rejects a payload when region is only whitespace", () => {
    const result = schema.safeParse({
      provider: "aws",
      region: "   ",
      label: "AWS US East",
    });

    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 5. Rejects empty label
  // ---------------------------------------------------------------------------
  it("rejects a payload when label is empty", () => {
    const result = schema.safeParse({
      provider: "aws",
      region: "us-east-1",
      label: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.path.join("."));
      expect(issues).toContain("label");
    }
  });

  it("rejects a payload when label is only whitespace", () => {
    const result = schema.safeParse({
      provider: "aws",
      region: "us-east-1",
      label: "   ",
    });

    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 6. Rejects custom provider without a non-empty customProvider field
  // ---------------------------------------------------------------------------
  it("rejects a payload with provider=custom but customProvider omitted", () => {
    const result = schema.safeParse({
      provider: "custom",
      region: "nyc3",
      label: "DO New York",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.path.join("."));
      expect(issues).toContain("customProvider");
    }
  });

  it("rejects a payload with provider=custom and customProvider is empty string", () => {
    const result = schema.safeParse({
      provider: "custom",
      customProvider: "",
      region: "nyc3",
      label: "DO New York",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a payload with provider=custom and customProvider is only whitespace", () => {
    const result = schema.safeParse({
      provider: "custom",
      customProvider: "   ",
      region: "nyc3",
      label: "DO New York",
    });

    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 7. enabled defaults to true when omitted
  // ---------------------------------------------------------------------------
  it("defaults enabled to true when the field is omitted", () => {
    const result = schema.safeParse({
      provider: "gcp",
      region: "us-central1",
      label: "GCP Central",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
    }
  });

  it("accepts enabled explicitly set to false", () => {
    const result = schema.safeParse({
      provider: "azure",
      region: "eastus",
      label: "Azure East",
      enabled: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
    }
  });

  // ---------------------------------------------------------------------------
  // 8. t() mock returns the key as-is (validated via error messages)
  // ---------------------------------------------------------------------------
  it("returns the i18n key as the error message for a required field", () => {
    const result = schema.safeParse({
      provider: "aws",
      region: "",
      label: "Label",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const regionIssue = result.error.issues.find(
        (i) => i.path.join(".") === "region"
      );
      expect(regionIssue).toBeDefined();
      expect(regionIssue!.message).toBe("synthetics.locations.regionRequired");
    }
  });

  it("returns the i18n key as the error message for missing customProvider", () => {
    const result = schema.safeParse({
      provider: "custom",
      region: "nyc3",
      label: "DO New York",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const customIssue = result.error.issues.find(
        (i) => i.path.join(".") === "customProvider"
      );
      expect(customIssue).toBeDefined();
      expect(customIssue!.message).toBe(
        "synthetics.locations.customProviderRequired"
      );
    }
  });
});
