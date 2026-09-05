// Copyright 2026 OpenObserve Inc.

// The create-form default must match the DB column default, the server default
// and the edit prefill (all 97). A higher value is silently clamped and
// truncated server-side, so the alert reopens showing a number nobody chose.

import { describe, it, expect } from "vitest";
import { defaultAnomalyConfig } from "@/composables/useAlertForm";

describe("defaultAnomalyConfig", () => {
  it("defaults threshold to the 97th percentile", () => {
    expect(defaultAnomalyConfig().threshold).toBe(97);
  });
});
