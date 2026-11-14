// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import type { NormalizedEvent } from "@/utils/security/ocsf";

import {
  entityKey,
  eventCaseTitle,
  eventEntities,
  makeOpenCaseSchema,
  parseEntityKey,
} from "./SecurityOpenCaseDialog.schema";

const t = (key: string) => key;
const event = (over: Partial<NormalizedEvent>) =>
  ({ host: "", actor: "", srcIp: "", dstIp: "", ...over }) as NormalizedEvent;

describe("open case from an event", () => {
  it("pre-extracts the host, user and addresses, host first and without repeats", () => {
    const entities = eventEntities(
      event({ host: "WS-01", actor: "dave@acme.io", srcIp: "10.0.0.5", dstIp: "10.0.0.5" }),
    );
    expect(entities).toEqual([
      { kind: "host", value: "WS-01" },
      { kind: "user", value: "dave@acme.io" },
      { kind: "ip", value: "10.0.0.5" },
    ]);
    expect(eventEntities(event({ actor: "-" }))).toEqual([]);
  });

  it("splits a column holding several addresses into one entity each", () => {
    expect(eventEntities(event({ srcIp: "45.137.21.9, 10.0.0.7" }))).toEqual([
      { kind: "ip", value: "45.137.21.9" },
      { kind: "ip", value: "10.0.0.7" },
    ]);
  });

  it("titles the case by the event's type and its first named entity", () => {
    expect(eventCaseTitle("Authentication", [{ kind: "ip", value: "1.2.3.4" }])).toBe(
      "Authentication on 1.2.3.4",
    );
    expect(
      eventCaseTitle("Sign-in", [
        { kind: "ip", value: "1.2.3.4" },
        { kind: "user", value: "dave" },
      ]),
    ).toBe("Sign-in on dave");
    expect(eventCaseTitle("Sign-in", [])).toBe("Sign-in");
  });

  it("round-trips an entity through its checkbox value, colons in the value included", () => {
    const e = { kind: "ip" as const, value: "fe80::1" };
    expect(parseEntityKey(entityKey(e))).toEqual(e);
    expect(parseEntityKey("process:x")).toBeNull();
  });

  it("needs a title and keeps the note within the server's limit", () => {
    const schema = makeOpenCaseSchema(t);
    expect(
      schema.safeParse({ target: "new", title: " ", priority: "P2", entities: [], note: "" })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        target: "new",
        title: "x",
        priority: "P2",
        entities: [],
        note: "n".repeat(4001),
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ target: "new", title: "x", priority: "P2", entities: [], note: "" })
        .success,
    ).toBe(true);
  });
});
