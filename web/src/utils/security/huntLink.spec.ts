// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { ALL_SOURCES, huntFromQuery, huntLinkQuery } from "./huntLink";

describe("hunt links", () => {
  it("round-trips a hunt through the URL", () => {
    const query = huntLinkQuery({ kind: "user", value: "dave", aliases: ["dave", "ACME\\dave"] });
    expect(query).toEqual({
      stream: ALL_SOURCES,
      hunt_kind: "user",
      hunt: "dave",
      hunt_aliases: JSON.stringify(["ACME\\dave"]),
    });
    expect(huntFromQuery(query)).toEqual({ kind: "user", value: "dave", aliases: ["ACME\\dave"] });
  });

  it("tolerates a hand-edited URL", () => {
    expect(huntFromQuery({ hunt_kind: "nope", hunt: "x", hunt_aliases: "{bad" })).toEqual({
      kind: "any",
      value: "x",
      aliases: [],
    });
  });
});
