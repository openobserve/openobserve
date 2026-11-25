// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mixedTypeFields } from "./valueTypeConflicts";

describe("mixedTypeFields", () => {
  const streams = [
    {
      name: "a",
      schema: [
        { name: "code", type: "Int64" },
        { name: "ok", type: "Boolean" },
        { name: "size", type: "UInt64" },
        { name: "msg", type: "Utf8" },
      ],
    },
    {
      name: "b",
      schema: [
        { name: "code", type: "Utf8" },
        { name: "ok", type: "Utf8" },
        { name: "size", type: "Float64" },
        { name: "msg", type: "Utf8View" },
      ],
    },
    { name: "c", schema: [{ name: "msg", type: "Int64" }] },
  ];

  it("lists fields typed as different kinds by the selected streams only", () => {
    expect([...mixedTypeFields(streams, ["a", "b"])].sort()).toEqual(["code", "ok"]);
    expect([...mixedTypeFields(streams, ["b", "c"])]).toEqual(["msg"]);
    expect(mixedTypeFields(streams, ["a"]).size).toBe(0);
  });

  it("ignores a stream whose schema is not loaded", () => {
    expect(mixedTypeFields([{ name: "a" }, streams[1]], ["a", "b"]).size).toBe(0);
  });
});
