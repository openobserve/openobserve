// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.fn();
vi.mock("@/services/search", () => ({
  default: { search: (...args: unknown[]) => search(...args) },
}));

import {
  PREVIEW_ROWS,
  PREVIEW_WINDOW_MS,
  VALIDATE_WINDOW_MS,
  searchFailureReason,
  useDetectionPreview,
} from "./useDetectionPreview";

const NOW = 1_800_000_000_000;
const SQL = `SELECT "_timestamp" FROM "windows_security" WHERE TRY_CAST("eventid" AS DOUBLE) = 4625`;
const planningError = {
  response: {
    status: 400,
    data: {
      code: 20008,
      message: "Search SQL execute error",
      error_detail: "Error during planning: Function 'lower' requires String, but received Int64",
    },
  },
};

describe("useDetectionPreview", () => {
  beforeEach(() => search.mockReset());

  it("previews the last 24 hours, first 20 rows", async () => {
    search.mockResolvedValue({ data: { hits: [{ _timestamp: 1 }], total: 31 } });
    const preview = useDetectionPreview();
    await preview.preview("default", SQL, NOW);

    const query = search.mock.calls[0][0].query.query;
    expect(query.sql).toBe(SQL);
    expect(query.size).toBe(PREVIEW_ROWS);
    expect(query.end_time - query.start_time).toBe(PREVIEW_WINDOW_MS * 1000);
    expect(query.end_time).toBe(NOW * 1000);
    expect(preview.rows.value).toEqual([{ _timestamp: 1 }]);
    expect(preview.total.value).toBe(31);
    expect(preview.error.value).toBe("");
  });

  it("shows the engine's reason when the preview query fails", async () => {
    search.mockRejectedValueOnce(planningError);
    const preview = useDetectionPreview();
    await preview.preview("default", SQL, NOW);
    expect(preview.error.value).toMatch(/lower' requires String/);
    expect(preview.rows.value).toEqual([]);
  });

  it("refuses a query that does not plan, checking a short window", async () => {
    search.mockRejectedValueOnce(planningError);
    const preview = useDetectionPreview();
    const reason = await preview.validate("default", SQL, NOW);
    expect(reason).toMatch(/Int64/);
    const query = search.mock.calls[0][0].query.query;
    expect(query.end_time - query.start_time).toBe(VALIDATE_WINDOW_MS * 1000);
    expect(query.size).toBe(1);
  });

  it("accepts a query that runs, and skips the check when a clean preview already ran it", async () => {
    search.mockResolvedValue({ data: { hits: [], total: 0 } });
    const preview = useDetectionPreview();
    expect(await preview.validate("default", SQL, NOW)).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);

    await preview.preview("default", SQL, NOW);
    expect(await preview.validate("default", SQL, NOW)).toBeNull();
    expect(search).toHaveBeenCalledTimes(2);

    expect(await preview.validate("default", `${SQL} AND 1 = 1`, NOW)).toBeNull();
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("re-checks on save when the preview of the same SQL failed", async () => {
    search.mockRejectedValueOnce(planningError).mockRejectedValueOnce(planningError);
    const preview = useDetectionPreview();
    await preview.preview("default", SQL, NOW);
    expect(await preview.validate("default", SQL, NOW)).toMatch(/planning/);
  });

  it("clears a preview on reset", async () => {
    search.mockResolvedValue({ data: { hits: [{ a: 1 }], total: 1 } });
    const preview = useDetectionPreview();
    await preview.preview("default", SQL, NOW);
    preview.reset();
    expect(preview.rows.value).toEqual([]);
    expect(preview.previewedSql.value).toBe("");
  });
});

describe("searchFailureReason", () => {
  it("prefers the engine detail, then the message", () => {
    expect(searchFailureReason(planningError)).toMatch(/^Error during planning/);
    expect(searchFailureReason({ response: { data: { message: "nope" } } })).toBe("nope");
    expect(searchFailureReason(new Error("network"))).toBe("network");
  });
});
