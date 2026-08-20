// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { bestMatch } from "./classify";
import { NORMALIZED_COLUMNS } from "./ocsf";
import { buildFacets, normalizeEvent, normalizeEvents, populatedColumns } from "./normalize";
import { SOURCE_TYPE_BY_ID } from "./sourceTypes";

const cloudtrail = {
  eventTime: "2026-08-18T09:00:00Z",
  eventSource: "s3.amazonaws.com",
  eventName: "GetObject",
  awsRegion: "us-east-1",
  sourceIPAddress: "203.0.113.42",
  "userIdentity.userName": "j.torres",
  "userIdentity.arn": "arn:aws:iam::1234:user/j.torres",
  recipientAccountId: "1234",
  errorCode: "AccessDenied",
};

const okta = (result: string) => ({
  published: "2026-08-18T09:00:00Z",
  eventType: "user.session.start",
  "actor.alternateId": "j.torres@example.com",
  "actor.id": "00u123",
  "outcome.result": result,
  "client.ipAddress": "203.0.113.42",
  displayMessage: "User login to Okta",
});

const nginx = (status: number) => ({
  _timestamp: 1787065456851000,
  remote_addr: "203.0.113.42",
  method: "POST",
  path: "/api/login",
  status,
  user_agent: "curl/8.5.0",
  host: "app.example.com",
});

const sourceFor = (sample: Record<string, unknown>) =>
  bestMatch(Object.keys(sample), { sample })!.source;

describe("normalizeEvent", () => {
  it("puts a CloudTrail row in the shared columns", () => {
    const event = normalizeEvent(cloudtrail, sourceFor(cloudtrail));

    expect(event.classUid).toBe(6003);
    expect(event.className).toBe("API Activity");
    expect(event.activity).toBe("GetObject");
    expect(event.actor).toBe("j.torres");
    expect(event.srcIp).toBe("203.0.113.42");
    expect(event.operation).toBe("GetObject");
    expect(event.resource).toBe("s3.amazonaws.com");
    expect(event.product).toBe("CloudTrail");
    expect(event.time).toBe(Date.parse("2026-08-18T09:00:00Z"));
  });

  it("reads outcome from whatever the source calls it", () => {
    expect(normalizeEvent(okta("SUCCESS"), sourceFor(okta("SUCCESS"))).statusId).toBe(1);
    expect(normalizeEvent(okta("FAILURE"), sourceFor(okta("FAILURE"))).statusId).toBe(2);
    // CloudTrail has no outcome field; an errorCode is the failure.
    expect(normalizeEvent(cloudtrail, sourceFor(cloudtrail)).statusId).toBe(2);
    // HTTP is numeric, and the split is at 400.
    expect(normalizeEvent(nginx(200), sourceFor(nginx(200))).statusId).toBe(1);
    expect(normalizeEvent(nginx(401), sourceFor(nginx(401))).statusId).toBe(2);
  });

  it("derives severity only where the source carries none", () => {
    const failedLogin = normalizeEvent(okta("FAILURE"), sourceFor(okta("FAILURE")));
    const goodLogin = normalizeEvent(okta("SUCCESS"), sourceFor(okta("SUCCESS")));

    // A failed authentication outranks a failed request of any other kind.
    expect(failedLogin.severityId).toBe(3);
    expect(goodLogin.severityId).toBe(1);
    expect(normalizeEvent(nginx(500), sourceFor(nginx(500))).severityId).toBe(2);
  });

  it("never overrides a severity the source states itself", () => {
    const ids = {
      _timestamp: 1787065456851000,
      "alert.signature": "ET MALWARE Suspicious Beacon",
      "alert.severity": 5,
      "alert.category": "Malware",
      src_ip: "10.0.0.15",
      dest_ip: "203.0.113.42",
    };
    expect(normalizeEvent(ids, sourceFor(ids)).severityId).toBe(5);
  });

  it("maps log level words onto the OCSF scale", () => {
    const app = { _timestamp: 1, message: "boom", level: "error", service: "checkout" };
    expect(normalizeEvent(app, sourceFor(app)).severityId).toBe(4);

    const warn = { ...app, level: "warning" };
    expect(normalizeEvent(warn, sourceFor(warn)).severityId).toBe(3);
  });

  it("brings timestamps of any precision to milliseconds", () => {
    const source = SOURCE_TYPE_BY_ID.get("application_log")!;
    const at = Date.parse("2026-08-18T09:00:00Z");

    expect(normalizeEvent({ _timestamp: at * 1000, message: "x" }, source).time).toBe(at); // micros
    expect(normalizeEvent({ _timestamp: at, message: "x" }, source).time).toBe(at); // millis
    expect(normalizeEvent({ _timestamp: at / 1000, message: "x" }, source).time).toBe(at); // seconds
    expect(normalizeEvent({ _timestamp: "2026-08-18T09:00:00Z", message: "x" }, source).time).toBe(
      at,
    );
  });

  it("leaves a column empty rather than inventing a value", () => {
    const sparse = { _timestamp: 1, eventName: "GetObject", eventSource: "s3.amazonaws.com" };
    const event = normalizeEvent(sparse, sourceFor(sparse));

    expect(event.actor).toBe("");
    expect(event.srcIp).toBe("");
    expect(event.host).toBe("");
  });

  it("keeps the original row for the detail view", () => {
    const event = normalizeEvent(cloudtrail, sourceFor(cloudtrail));
    expect(event.raw).toBe(cloudtrail);
  });

  it("flattens list and object values instead of printing [object Object]", () => {
    const k8sAudit = {
      _timestamp: 1,
      verb: "delete",
      "objectRef.resource": "secrets",
      "user.username": "system:serviceaccount:prod:deployer",
      sourceIPs: ["10.0.0.15", "10.0.0.16"],
      "responseStatus.code": 403,
    };
    const event = normalizeEvent(k8sAudit, sourceFor(k8sAudit));

    expect(event.srcIp).toBe("10.0.0.15, 10.0.0.16");
    expect(event.actor).toBe("system:serviceaccount:prod:deployer");
    expect(event.statusId).toBe(2);
  });

  it("passes a native OCSF row through on its own fields", () => {
    const native = {
      _timestamp: 1787065456851000,
      class_uid: 4003,
      class_name: "DNS Activity",
      activity_name: "Query",
      severity_id: 2,
      "src_endpoint.ip": "10.0.0.15",
      "metadata.product.name": "CoreDNS",
    };
    const event = normalizeEvent(native, sourceFor(native));

    expect(event.classUid).toBe(4003);
    expect(event.className).toBe("DNS Activity");
    expect(event.severityId).toBe(2);
    expect(event.product).toBe("CoreDNS");
  });
});

describe("populatedColumns", () => {
  it("keeps only the columns this source actually fills", () => {
    const events = normalizeEvents([cloudtrail], sourceFor(cloudtrail));
    const columns = populatedColumns(events, NORMALIZED_COLUMNS);

    expect(columns).toContain("actor");
    expect(columns).toContain("srcIp");
    expect(columns).toContain("operation");
    // CloudTrail carries no destination or process, so those columns stay off
    // rather than rendering a wall of empty cells.
    expect(columns).not.toContain("dstIp");
    expect(columns).not.toContain("process");
  });

  it("always keeps time and severity, which are meaningful even when sparse", () => {
    const columns = populatedColumns([], NORMALIZED_COLUMNS);
    expect(columns).toEqual(["time", "severityId"]);
  });
});

describe("buildFacets", () => {
  it("summarises what is on screen", () => {
    const rows = [okta("FAILURE"), okta("FAILURE"), okta("SUCCESS")];
    const events = normalizeEvents(rows, sourceFor(rows[0]));
    const facets = buildFacets(events);

    expect(facets.severity.find((s) => s.id === 3)?.count).toBe(2);
    expect(facets.status.find((s) => s.id === 2)?.count).toBe(2);
    expect(facets.topActors[0]).toEqual({ value: "j.torres@example.com", count: 3 });
    expect(facets.topSourceIps[0]).toEqual({ value: "203.0.113.42", count: 3 });
  });

  it("orders severity worst first", () => {
    const events = normalizeEvents([okta("SUCCESS"), okta("FAILURE")], sourceFor(okta("SUCCESS")));
    expect(buildFacets(events).severity[0].id).toBe(3);
  });
});
