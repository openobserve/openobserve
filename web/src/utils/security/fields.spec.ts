// Copyright 2026 OpenObserve Inc.

// Expected column names were read back from a live instance's schema after real ingestion.

import { describe, expect, it } from "vitest";

import { FieldIndex, readPath, toColumnName } from "./fields";

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

describe("readPath", () => {
  it("reads a flattened dotted column, a nested object and an ingested column", () => {
    expect(readPath({ "actor.user.name": "j.torres" }, "actor.user.name")).toBe("j.torres");
    expect(readPath({ actor: { user: { name: "j.torres" } } }, "actor.user.name")).toBe("j.torres");
    expect(readPath({ useridentity_type: "IAMUser" }, "userIdentity.type")).toBe("IAMUser");
  });

  it("reads the JSON remainder past the flatten depth", () => {
    const row = { process_parent_process_file: '{"path":"C:\\\\x.exe"}' };
    expect(readPath(row, "process.parent_process.file.path")).toBe("C:\\x.exe");
    expect(readPath({ process_parent_process_file: "x" }, "process.parent_process.file.path")).toBe(
      undefined,
    );
  });

  it("returns undefined rather than throwing on a missing branch", () => {
    expect(readPath({ actor: null }, "actor.user.name")).toBeUndefined();
    expect(readPath(null, "a.b")).toBeUndefined();
  });
});
