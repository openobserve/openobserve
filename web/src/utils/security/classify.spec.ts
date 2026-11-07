// Copyright 2026 OpenObserve Inc.
//
// The samples below are shaped like the real thing, because the whole point of
// the classifier is that it works on logs as they actually arrive rather than on
// tidied-up examples.

import { describe, expect, it } from "vitest";

import { bestMatch, classifyStream, isSecuritySource, readPath } from "./classify";

const fieldsOf = (sample: Record<string, unknown>): string[] => Object.keys(sample);

const CLOUDTRAIL = {
  eventTime: "2026-08-18T09:00:00Z",
  eventSource: "s3.amazonaws.com",
  eventName: "GetObject",
  awsRegion: "us-east-1",
  sourceIPAddress: "203.0.113.42",
  "userIdentity.type": "IAMUser",
  "userIdentity.userName": "j.torres",
  "userIdentity.arn": "arn:aws:iam::1234:user/j.torres",
  recipientAccountId: "1234",
};

const OKTA = {
  published: "2026-08-18T09:00:00Z",
  eventType: "user.session.start",
  "actor.alternateId": "j.torres@example.com",
  "actor.id": "00u123",
  "outcome.result": "FAILURE",
  "client.ipAddress": "203.0.113.42",
  displayMessage: "User login to Okta",
};

const SYSMON = {
  UtcTime: "2026-08-18 09:00:00.000",
  Image: "C:\\Windows\\System32\\cmd.exe",
  CommandLine: "cmd.exe /c whoami",
  ParentImage: "C:\\Windows\\explorer.exe",
  ProcessGuid: "{abc}",
  User: "CORP\\jtorres",
  Computer: "WIN-DC01",
};

const WINDOWS_SECURITY = {
  EventID: 4625,
  Channel: "Security",
  Computer: "WIN-DC01",
  TargetUserName: "administrator",
  LogonType: 3,
  IpAddress: "203.0.113.42",
  Provider_Name: "Microsoft-Windows-Security-Auditing",
};

const NGINX = {
  _timestamp: 1787065456851000,
  remote_addr: "203.0.113.42",
  method: "POST",
  path: "/api/login",
  status: 401,
  body_bytes_sent: 512,
  user_agent: "curl/8.5.0",
  host: "app.example.com",
};

const FIREWALL = {
  _timestamp: 1787065456851000,
  src_ip: "203.0.113.42",
  dst_ip: "10.0.0.1",
  src_port: 44321,
  dst_port: 443,
  action: "deny",
  protocol: "tcp",
  rule: "block-inbound",
};

const K8S_CONTAINER = {
  _timestamp: 1787065456851000,
  "kubernetes.pod_name": "checkout-7d9f",
  "kubernetes.namespace_name": "prod",
  "kubernetes.container_name": "checkout",
  log: "processed order 5512",
  stream: "stdout",
};

const SSHD = {
  _timestamp: 1787065456851000,
  hostname: "bastion-1",
  program: "sshd",
  facility: "auth",
  message: "Failed password for invalid user admin from 203.0.113.42 port 55234 ssh2",
};

const DNS = {
  _timestamp: 1787065456851000,
  query: "malware.example.com",
  query_type: "A",
  rcode: "NXDOMAIN",
  client_ip: "10.0.0.15",
};

const OCSF_NATIVE = {
  _timestamp: 1787065456851000,
  class_uid: 3002,
  class_name: "Authentication",
  activity_name: "Logon",
  severity_id: 4,
  "actor.user.name": "j.torres",
  "src_endpoint.ip": "203.0.113.42",
  "metadata.version": "1.1.0",
};

describe("classifyStream", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["CloudTrail", CLOUDTRAIL, "aws_cloudtrail"],
    ["Okta", OKTA, "okta_system_log"],
    ["Sysmon process creation", SYSMON, "windows_sysmon_process"],
    ["Windows Security", WINDOWS_SECURITY, "windows_security"],
    ["nginx access", NGINX, "webserver_access"],
    ["firewall", FIREWALL, "firewall"],
    ["Kubernetes container", K8S_CONTAINER, "kubernetes_container"],
    ["sshd via syslog", SSHD, "linux_auth"],
    ["DNS query", DNS, "dns_query"],
    ["native OCSF", OCSF_NATIVE, "ocsf_native"],
  ];

  it.each(cases)("recognises %s", (_label, sample, expected) => {
    const match = bestMatch(fieldsOf(sample), { sample });
    expect(match?.source.id).toBe(expected);
  });

  it("names the evidence behind a match, so it can be argued with", () => {
    const match = bestMatch(fieldsOf(CLOUDTRAIL), { sample: CLOUDTRAIL })!;

    expect(match.matchedRequired).toEqual(["eventName", "eventSource"]);
    expect(match.matchedSignals).toContain("awsRegion");
    expect(match.matchedSignals).toContain("sourceIPAddress");
    expect(match.confidence).toBeGreaterThan(0.6);
  });

  // Sysmon and the Security log share Computer and a Windows shape; only the
  // process fields separate them, which is what `absent` is for.
  it("keeps Sysmon and the Windows Security log apart", () => {
    expect(bestMatch(fieldsOf(SYSMON), { sample: SYSMON })?.source.id).toBe(
      "windows_sysmon_process",
    );
    expect(bestMatch(fieldsOf(WINDOWS_SECURITY), { sample: WINDOWS_SECURITY })?.source.id).toBe(
      "windows_security",
    );
    const sysmonCandidates = classifyStream(fieldsOf(SYSMON), { sample: SYSMON }).map(
      (c) => c.source.id,
    );
    expect(sysmonCandidates).not.toContain("windows_security");
  });

  it("does not read a webserver log as a firewall", () => {
    const ids = classifyStream(fieldsOf(NGINX), { sample: NGINX }).map((c) => c.source.id);
    expect(ids[0]).toBe("webserver_access");
    expect(ids).not.toContain("firewall");
  });

  // A syslog stream is only sshd because of what the program field SAYS, which
  // is the one case a schema alone cannot settle.
  it("uses values, not just fields, where the shape is identical", () => {
    const cron = { ...SSHD, program: "CRON", message: "session opened for user root" };

    expect(bestMatch(fieldsOf(SSHD), { sample: SSHD })?.source.id).toBe("linux_auth");
    expect(bestMatch(fieldsOf(cron), { sample: cron })?.source.id).toBe("syslog_generic");
  });

  it("classifies from a schema alone, with less confidence than with a sample", () => {
    const withSample = bestMatch(fieldsOf(OKTA), { sample: OKTA })!;
    const schemaOnly = bestMatch(fieldsOf(OKTA))!;

    expect(schemaOnly.source.id).toBe("okta_system_log");
    expect(withSample.confidence).toBeGreaterThanOrEqual(schemaOnly.confidence);
  });

  it("ranks a specific source above the generic one it overlaps", () => {
    const ids = classifyStream(fieldsOf(SSHD), { sample: SSHD }).map((c) => c.source.id);
    expect(ids.indexOf("linux_auth")).toBeLessThan(ids.indexOf("syslog_generic"));
  });

  it("returns nothing for a stream with no recognisable shape", () => {
    const metrics = { _timestamp: 1, cpu_pct: 92.5, mem_pct: 44.1, node: "n-1" };
    expect(bestMatch(fieldsOf(metrics), { sample: metrics })).toBeNull();
  });

  it("separates security sources from plain telemetry", () => {
    expect(isSecuritySource(bestMatch(fieldsOf(CLOUDTRAIL), { sample: CLOUDTRAIL }))).toBe(true);
    // Container stdout still classifies, so its events are readable, but it is
    // not presented as a security source.
    const k8s = bestMatch(fieldsOf(K8S_CONTAINER), { sample: K8S_CONTAINER });
    expect(k8s?.source.id).toBe("kubernetes_container");
    expect(isSecuritySource(k8s)).toBe(false);
  });

  it("carries the Sigma logsource that decides which rules apply", () => {
    expect(bestMatch(fieldsOf(CLOUDTRAIL), { sample: CLOUDTRAIL })?.source.sigma).toEqual({
      product: "aws",
      service: "cloudtrail",
    });
    expect(bestMatch(fieldsOf(SYSMON), { sample: SYSMON })?.source.sigma).toEqual({
      category: "process_creation",
      product: "windows",
    });
  });
});

describe("readPath", () => {
  it("reads a flattened dotted column", () => {
    expect(readPath({ "actor.user.name": "j.torres" }, "actor.user.name")).toBe("j.torres");
  });

  it("reads a nested object by the same path", () => {
    expect(readPath({ actor: { user: { name: "j.torres" } } }, "actor.user.name")).toBe("j.torres");
  });

  it("returns undefined rather than throwing on a missing branch", () => {
    expect(readPath({ actor: null }, "actor.user.name")).toBeUndefined();
    expect(readPath(null, "a.b")).toBeUndefined();
  });
});
