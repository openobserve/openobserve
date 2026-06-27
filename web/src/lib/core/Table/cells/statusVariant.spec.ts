// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { statusVariant, humanizeStatus } from "./statusVariant";

describe("statusVariant", () => {
  it("maps healthy/active states to success-soft with a dot", () => {
    for (const v of ["active", "Enabled", "healthy", "PAID", "success"]) {
      const r = statusVariant(v);
      expect(r.variant).toBe("success-soft");
      expect(r.tone).toBe("success");
      expect(r.dot).toBe(true);
    }
  });

  it("maps transient states to warning-soft", () => {
    for (const v of ["paused", "pending", "degraded", "training", "queued"]) {
      expect(statusVariant(v).variant).toBe("warning-soft");
    }
  });

  it("maps failure states to error-soft", () => {
    for (const v of ["failed", "error", "overdue", "critical", "down"]) {
      expect(statusVariant(v).variant).toBe("error-soft");
    }
  });

  it("maps running/scheduled to blue-soft (info)", () => {
    for (const v of ["running", "scheduled", "processing"]) {
      expect(statusVariant(v).variant).toBe("blue-soft");
    }
  });

  it("maps draft/disabled/unknown to default-soft (neutral)", () => {
    for (const v of ["draft", "disabled", "inactive", "whatisthis"]) {
      expect(statusVariant(v).variant).toBe("default-soft");
    }
  });

  it("accepts booleans", () => {
    expect(statusVariant(true).tone).toBe("success");
    expect(statusVariant(false).tone).toBe("error");
  });

  it("honours domain overrides", () => {
    // invoice "open" is informational, not a warning
    expect(statusVariant("open", "invoice").tone).toBe("info");
    expect(statusVariant("open").tone).toBe("warning");
    // eval "archived" stays neutral
    expect(statusVariant("archived", "eval").tone).toBe("neutral");
  });

  it("falls back to token-contains matching", () => {
    expect(statusVariant("auth_failed").tone).toBe("error");
    expect(statusVariant("job-running").tone).toBe("info");
  });

  it("renders an em-dash label for empty values", () => {
    expect(statusVariant("").label).toBe("—");
    expect(statusVariant(null).label).toBe("—");
  });

  it("humanizes labels", () => {
    expect(humanizeStatus("in_progress")).toBe("In Progress");
    expect(humanizeStatus("real-time")).toBe("Real Time");
    expect(statusVariant("paused").label).toBe("Paused");
  });
});
