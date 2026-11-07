// Copyright 2026 OpenObserve Inc.
//
// The expectations here were taken from a live instance: the fixtures were
// ingested through the real ingest path and the resulting schema read back, so
// these are the column names OpenObserve actually produces rather than the ones
// this file assumes it produces.

import { describe, expect, it } from "vitest";

import { FieldIndex, toColumnName } from "./fields";

describe("toColumnName", () => {
  it("collapses nesting into underscores", () => {
    expect(toColumnName("userIdentity.type")).toBe("useridentity_type");
    expect(toColumnName("additionalEventData.MFAUsed")).toBe("additionaleventdata_mfaused");
    expect(toColumnName("responseElements.ConsoleLogin")).toBe("responseelements_consolelogin");
  });

  it("lower-cases without otherwise touching a plain name", () => {
    expect(toColumnName("CommandLine")).toBe("commandline");
    expect(toColumnName("EventID")).toBe("eventid");
    expect(toColumnName("message")).toBe("message");
    expect(toColumnName("src_ip")).toBe("src_ip");
  });

  it("replaces every character that is not a letter, a digit or an underscore", () => {
    expect(toColumnName("c-uri")).toBe("c_uri");
    expect(toColumnName("id.orig_h")).toBe("id_orig_h");
    expect(toColumnName("Provider_Name")).toBe("provider_name");
    expect(toColumnName("k8s.pod/name")).toBe("k8s_pod_name");
  });

  it("is idempotent, so a name that is already a column stays one", () => {
    const column = toColumnName("userIdentity.type");
    expect(toColumnName(column)).toBe(column);
  });
});

describe("FieldIndex", () => {
  const index = new FieldIndex([
    "_timestamp",
    "eventname",
    "eventsource",
    "useridentity_type",
    "additionaleventdata_mfaused",
  ]);

  it("finds a column by the producer's spelling", () => {
    expect(index.resolve("eventName")).toBe("eventname");
    expect(index.resolve("userIdentity.type")).toBe("useridentity_type");
    expect(index.resolve("additionalEventData.MFAUsed")).toBe("additionaleventdata_mfaused");
  });

  it("returns the column as stored, not as asked for", () => {
    // The caller quotes this into SQL, so it has to be the real name.
    expect(index.resolve("EVENTNAME")).toBe("eventname");
  });

  it("says no rather than guessing when a field is absent", () => {
    expect(index.resolve("CommandLine")).toBeNull();
    expect(index.has("errorCode")).toBe(false);
  });

  it("prefers a column stored exactly as written over one that normalizes to it", () => {
    const both = new FieldIndex(["user.name", "user_name"]);
    expect(both.resolve("user.name")).toBe("user.name");
    expect(both.resolve("user_name")).toBe("user_name");
  });
});
