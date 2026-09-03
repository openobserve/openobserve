// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { defaultAnomalyConfig } from "@/composables/useAlertForm";

// The threshold column still defaults to 97; every insert Sets it, so that default never applies.
const UNREACHABLE_DB_COLUMN_DEFAULT = 97;

// The value the server applies when a request omits `percentile`.
const SERVER_DEFAULT = 95;

describe("defaultAnomalyConfig", () => {
  it("defaults threshold to the server default, not the stale DB column default", () => {
    expect(defaultAnomalyConfig().threshold).toBe(SERVER_DEFAULT);
    expect(defaultAnomalyConfig().threshold).not.toBe(UNREACHABLE_DB_COLUMN_DEFAULT);
  });
});
