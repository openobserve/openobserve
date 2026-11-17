// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.fn();
const previewDetection = vi.fn();
vi.mock("@/services/search", () => ({
  default: { search: (...args: unknown[]) => search(...args) },
}));
vi.mock("@/services/securitySigma", () => ({
  default: { previewDetection: (...args: unknown[]) => previewDetection(...args) },
}));

import {
  DEFAULT_PREVIEW_RANGE,
  VALIDATE_WINDOW_MS,
  previewKey,
  searchFailureReason,
  useDetectionPreview,
} from "./useDetectionPreview";

const NOW = 1_800_000_000_000;
const SQL = `SELECT "_timestamp" FROM "windows_security" WHERE TRY_CAST("eventid" AS DOUBLE) = 4625`;
const REQUEST = {
  rule_id: "spray",
  stream: "entra_signin",
  range_minutes: DEFAULT_PREVIEW_RANGE,
  period: 30,
  frequency: 15,
};
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
const answer = (over: Record<string, unknown> = {}) => ({
  data: {
    range_start: 1,
    range_end: 2,
    requested_minutes: 1440,
    correlation: true,
    window_minutes: 30,
    stride_minutes: 15,
    windows_evaluated: 95,
    windows_failed: 0,
    firings: 1,
    windows: [{ start: 1, end: 2, firings: 1 }],
    sample: [{ window_start: 1, window_end: 2, row: { ipAddress: "1.2.3.4" } }],
    sql: SQL,
    ...over,
  },
});

describe("useDetectionPreview", () => {
  beforeEach(() => {
    search.mockReset();
    previewDetection.mockReset();
  });

  it("asks the server to run the draft over history and keeps its answer", async () => {
    previewDetection.mockResolvedValue(answer());
    const preview = useDetectionPreview();
    await preview.preview("default", REQUEST);

    expect(previewDetection).toHaveBeenCalledWith("default", REQUEST);
    expect(preview.result.value?.firings).toBe(1);
    expect(preview.result.value?.windows_evaluated).toBe(95);
    expect(preview.previewedKey.value).toBe(previewKey(REQUEST));
    expect(preview.error.value).toBe("");
  });

  it("shows why a rule cannot run, and the engine's reason when the request fails", async () => {
    previewDetection.mockResolvedValueOnce(answer({ error: "column ipAddress is missing" }));
    const preview = useDetectionPreview();
    await preview.preview("default", REQUEST);
    expect(preview.error.value).toBe("column ipAddress is missing");

    previewDetection.mockRejectedValueOnce(planningError);
    await preview.preview("default", REQUEST);
    expect(preview.error.value).toMatch(/lower' requires String/);
    expect(preview.result.value).toBeNull();
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

  it("skips the save check for SQL a clean preview already ran, but not after a failed window", async () => {
    search.mockResolvedValue({ data: { hits: [], total: 0 } });
    const preview = useDetectionPreview();
    previewDetection.mockResolvedValueOnce(answer());
    await preview.preview("default", REQUEST);
    expect(await preview.validate("default", SQL, NOW)).toBeNull();
    expect(search).not.toHaveBeenCalled();

    const other = useDetectionPreview();
    previewDetection.mockResolvedValueOnce(answer({ windows_failed: 2 }));
    await other.preview("default", REQUEST);
    expect(await other.validate("default", SQL, NOW)).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("drops an older answer that lands after a newer request, and clears on reset", async () => {
    let resolveOld: (v: unknown) => void = () => {};
    previewDetection.mockReturnValueOnce(new Promise((r) => (resolveOld = r)));
    previewDetection.mockResolvedValueOnce(answer({ firings: 7 }));
    const preview = useDetectionPreview();
    const old = preview.preview("default", REQUEST);
    await preview.preview("default", { ...REQUEST, range_minutes: 60 });
    resolveOld(answer({ firings: 1 }));
    await old;
    expect(preview.result.value?.firings).toBe(7);

    preview.reset();
    expect(preview.result.value).toBeNull();
    expect(preview.previewedKey.value).toBe("");
  });
});

describe("searchFailureReason", () => {
  it("prefers the engine detail, then the message", () => {
    expect(searchFailureReason(planningError)).toMatch(/^Error during planning/);
    expect(searchFailureReason({ response: { data: { message: "nope" } } })).toBe("nope");
    expect(searchFailureReason(new Error("network"))).toBe("network");
  });
});
