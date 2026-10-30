// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { resolveTraceStream } from "./streamSelection";

describe("resolveTraceStream", () => {
  const streams = [
    { name: "older", stats: { doc_time_max: 10 } },
    { name: "default", stats: { doc_time_max: 20 } },
    { name: "newer", stats: { doc_time_max: 30 } },
  ];

  it("uses the first valid preferred stream", () => {
    expect(resolveTraceStream(streams, ["missing", "older", "newer"])).toBe("older");
  });

  it("uses the default stream before the latest stream", () => {
    expect(resolveTraceStream(streams)).toBe("default");
  });

  it("uses the stream with the latest data when default is unavailable", () => {
    expect(resolveTraceStream([streams[0], streams[2]])).toBe("newer");
  });

  it("uses the first stream when timestamps are unavailable", () => {
    expect(resolveTraceStream([{ name: "first" }, { name: "second" }])).toBe("first");
  });

  it("returns an empty selection when no streams are available", () => {
    expect(resolveTraceStream([])).toBe("");
  });
});
