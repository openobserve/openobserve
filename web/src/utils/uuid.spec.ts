// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { getUUID, getUUIDv7 } from "./uuid";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UUID_V7_COMPACT_REGEX = /^[0-9a-f]{32}$/i;

afterEach(() => {
  vi.clearAllMocks();
});

describe("getUUID", () => {
  it("returns a string that matches the UUID v4 format", () => {
    const result = getUUID();

    expect(UUID_V4_REGEX.test(result)).toBe(true);
  });

  it("contains version digit 4 in the correct position", () => {
    const result = getUUID();

    expect(result[14]).toBe("4");
  });

  it("returns different values on successive calls", () => {
    const first = getUUID();
    const second = getUUID();

    expect(first).not.toBe(second);
  });

  it("returns a string of exactly 36 characters", () => {
    const result = getUUID();

    expect(result).toHaveLength(36);
  });
});

describe("getUUIDv7", () => {
  it("returns a string that matches the UUID v7 format", () => {
    const result = getUUIDv7();

    expect(UUID_V7_REGEX.test(result)).toBe(true);
  });

  it("contains version digit 7 in the correct position", () => {
    const result = getUUIDv7();

    expect(result[14]).toBe("7");
  });

  it("returns different values on successive calls", () => {
    const first = getUUIDv7();
    const second = getUUIDv7();

    expect(first).not.toBe(second);
  });

  it("returns a string of exactly 36 characters", () => {
    const result = getUUIDv7();

    expect(result).toHaveLength(36);
  });

  it("produces lexicographically ordered values across time", async () => {
    const first = getUUIDv7();
    await new Promise((r) => setTimeout(r, 2));
    const second = getUUIDv7();

    expect(first < second).toBe(true);
  });

  describe("compact mode", () => {
    it("returns a string without dashes", () => {
      const result = getUUIDv7(true);

      expect(result).not.toContain("-");
    });

    it("returns exactly 32 characters", () => {
      const result = getUUIDv7(true);

      expect(result).toHaveLength(32);
    });

    it("contains only hex characters", () => {
      const result = getUUIDv7(true);

      expect(UUID_V7_COMPACT_REGEX.test(result)).toBe(true);
    });

    it("preserves the version 7 digit when compact", () => {
      const result = getUUIDv7(true);

      expect(result[12]).toBe("7");
    });
  });
});
