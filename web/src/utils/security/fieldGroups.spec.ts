// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { groupFields } from "./fieldGroups";

describe("groupFields", () => {
  it("groups by OCSF object in reading order, the rest last", () => {
    const groups = groupFields([
      { name: "zeek_uid" },
      { name: "src_endpoint_ip" },
      { name: "severity_id" },
      { name: "actor_user_name" },
    ]);
    expect(groups.map((g) => g.group)).toEqual(["event", "actor", "src", "other"]);
    expect(groups[3].fields).toEqual([{ name: "zeek_uid" }]);
  });

  it("puts _timestamp in the Event group, not under Other (S18)", () => {
    const groups = groupFields([{ name: "zeek_uid" }, { name: "_timestamp" }]);
    expect(groups.map((g) => g.group)).toEqual(["event", "other"]);
    expect(groups[0].fields).toEqual([{ name: "_timestamp" }]);
  });
});
