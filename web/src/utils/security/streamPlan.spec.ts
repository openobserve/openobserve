// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { acceptOutcome, estimateRowsInWindow, planStream, volumeFromStats } from "./streamPlan";
import { SOURCE_TYPE_BY_ID } from "@/views/Security/__fixtures__/securitySourceTypes";

const ctFields = [
  "_timestamp",
  "eventname",
  "eventsource",
  "useridentity_username",
  "useridentity_arn",
  "sourceipaddress",
  "recipientaccountid",
  "errorcode",
];
const authFields = ["_timestamp", "user", "src_ip", "host", "outcome", "level", "message"];

describe("planStream", () => {
  it("reads an OCSF status_id as the enum it is, with no sampling", () => {
    const plan = planStream(
      "ocsf",
      ["_timestamp", "class_uid", "status_id", "actor_user_name", "src_endpoint_ip"],
      SOURCE_TYPE_BY_ID.get("ocsf_native")!,
    );
    expect(plan.outcomeColumn).toBeNull();
    expect(plan.failure).toEqual({ kind: "ocsf_status", column: "status_id" });
    expect(plan.columns.user).toBe("actor_user_name");
  });

  it("reads entity columns from the source's field map", () => {
    const plan = planStream("ct", ctFields, SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!);
    expect(plan.columns.user).toBe("useridentity_username");
    expect(plan.columns.ip).toBe("sourceipaddress");
    expect(plan.failure).toEqual({ kind: "present", columns: ["errorcode"] });
  });

  it("falls back to common names when the source maps no actor", () => {
    const plan = planStream("auth", authFields, SOURCE_TYPE_BY_ID.get("syslog_generic")!);
    expect(plan.columns).toEqual({ user: "user", ip: "src_ip", host: "host" });
    expect(plan.outcomeColumn).toBe("outcome");
    expect(plan.failure).toBeNull();
  });

  it("trusts an outcome column only when its values can be read", () => {
    const plan = planStream("auth", authFields, null);
    const words = acceptOutcome(plan, [
      { value: "success", n: 80 },
      { value: "failure", n: 20 },
    ]);
    expect(words.failure).toEqual({ kind: "outcome", column: "outcome" });
    expect(words.outcomeColumn).toBeNull();
    const grpc = acceptOutcome(plan, [
      { value: "0", n: 50 },
      { value: "7", n: 50 },
    ]);
    expect(grpc.failure).toBeNull();
  });

  it("reads Windows logon failures from event codes before the NTSTATUS column", () => {
    const fields = ["_timestamp", "EventID", "Computer", "TargetUserName", "IpAddress", "Status"];
    const plan = planStream("win", fields, SOURCE_TYPE_BY_ID.get("windows_security")!);
    expect(plan.outcomeColumn).toBeNull();
    expect(plan.failure).toEqual({
      kind: "event_code",
      column: "EventID",
      codes: [4625, 4740, 4771],
      statusCodes: [4776],
      status: "Status",
    });
  });

  it("drops the status-gated codes when the stream has no status column", () => {
    const fields = ["_timestamp", "EventID", "TargetUserName", "Keywords"];
    const plan = planStream("win", fields, SOURCE_TYPE_BY_ID.get("windows_security")!);
    expect(plan.failure).toEqual({
      kind: "event_code",
      column: "EventID",
      codes: [4625, 4740, 4771],
      keywords: "Keywords",
    });
  });

  it("says nothing about failure when the stream has no outcome", () => {
    const plan = planStream("x", ["_timestamp", "user"], null);
    expect(plan.failure).toBeNull();
    expect(plan.outcomeColumn).toBeNull();
  });
});

describe("stream volume", () => {
  const HOUR = 3_600_000_000;
  const DAY = 24 * HOUR;

  it("reads doc_num and the µs time span from /streams stats", () => {
    expect(volumeFromStats({ doc_num: 10, doc_time_min: 5, doc_time_max: 9 })).toEqual({
      docNum: 10,
      timeMinUs: 5,
      timeMaxUs: 9,
    });
    expect(volumeFromStats({ doc_num: 0, doc_time_min: 5, doc_time_max: 9 })).toBeNull();
    expect(volumeFromStats(undefined)).toBeNull();
  });

  it("scales the row count to the window by the stream's ingest rate", () => {
    const volume = { docNum: 1000, timeMinUs: 0, timeMaxUs: HOUR };
    expect(estimateRowsInWindow(volume, HOUR / 2, DAY)).toBe(500);
    expect(estimateRowsInWindow(volume, 2 * HOUR, DAY)).toBe(0);
    expect(estimateRowsInWindow(null, 0, DAY)).toBeNull();
  });
});
