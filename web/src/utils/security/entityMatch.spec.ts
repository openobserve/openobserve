// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { entityValues, plainEntityText, rowNamesEntity } from "./entityMatch";

describe("entity matching", () => {
  it("splits arrays and their stored JSON text into values", () => {
    expect(entityValues('["45.137.21.9","10.0.0.7"]')).toEqual(["45.137.21.9", "10.0.0.7"]);
    expect(entityValues(["a", 1])).toEqual(["a", "1"]);
    expect(entityValues("[not json")).toEqual(["[not json"]);
    expect(plainEntityText('["45.137.21.9"]')).toBe("45.137.21.9");
  });

  it("matches a host by its short name, case-insensitively", () => {
    const host = [{ kind: "host" as const, value: "win-fin-008" }];
    expect(rowNamesEntity({ Computer: "WIN-FIN-008.acme.local" }, host)).toBe(true);
    expect(rowNamesEntity({ Computer: "WIN-FIN-009" }, host)).toBe(false);
  });

  it("matches a user across domain, UPN and ARN spellings", () => {
    const user = [{ kind: "user" as const, value: "mei.miller@aws:111122223333" }];
    expect(
      rowNamesEntity({ userIdentity_arn: "arn:aws:iam::111122223333:user/mei.miller" }, user),
    ).toBe(true);
    const ad = [{ kind: "user" as const, value: "luke.allen@acme" }];
    expect(rowNamesEntity({ TargetUserName: "ACME\\luke.allen" }, ad)).toBe(true);
    expect(rowNamesEntity({ upn: "luke.allen@acme.example" }, ad)).toBe(true);
    expect(rowNamesEntity({ upn: "paul.diaz@acme.example" }, ad)).toBe(false);
  });

  it("matches an address inside an array column", () => {
    const ip = [{ kind: "ip" as const, value: "10.30.1.13" }];
    expect(rowNamesEntity({ sourceips: '["10.30.1.13"]' }, ip)).toBe(true);
    expect(rowNamesEntity({ srcaddr: "10.40.0.11" }, ip)).toBe(false);
  });

  it("keeps every row when the case names no entity", () => {
    expect(rowNamesEntity({ anything: 1 }, [])).toBe(true);
  });
});
