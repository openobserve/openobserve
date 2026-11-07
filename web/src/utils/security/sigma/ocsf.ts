// Copyright 2026 OpenObserve Inc.
//
// sigma/ocsf.ts — Sigma rules running on OCSF-normalized data.
//
// A Sigma rule names fields the way its logsource writes them: a Windows
// process-creation rule says `Image` and `CommandLine`, a web rule says `c-uri`.
// Data that was normalized to OCSF before it arrived (AWS Security Lake, an
// OCSF pipeline, an EDR's OCSF export) carries the same facts under OCSF's
// paths instead: `process.file.path`, `process.cmd_line`, `http_request.url.path`.
// Without a bridge, none of the public corpus can run on such a stream, which
// defeats the reason to normalize in the first place.
//
// Each profile says which Sigma logsources an OCSF class answers for, which
// OCSF path each Sigma field becomes, and the guard that keeps the rule on the
// right events, since one OCSF stream usually mixes classes. The guard is
// AND-ed onto the rule rather than spliced into it, so a condition such as
// `1 of them` still means what the rule's author wrote.
//
// Targets use `a|b` for "whichever the stream has", because OCSF has moved some
// attributes between versions (a parent process is `process.parent_process` in
// 1.x and `actor.process` in some producers). A Sigma field with no OCSF home is
// simply not listed, and the compiler treats it as absent (strictFieldMap), even
// when an OCSF column happens to share its name: `status` or `type` in a Sigma
// rule does not mean OCSF's `status` or `type`.
//
// Field paths follow the OCSF 1.x schema, https://schema.ocsf.io.

import type { SigmaLogsource, SigmaRule } from "./types";

export interface OcsfSigmaProfile {
  id: string;
  /** Sigma logsources this profile serves; a missing part matches anything. */
  logsources: SigmaLogsource[];
  /** OCSF class the events must belong to. */
  classUid: number;
  /** OCSF activity_id within that class, when the logsource means one activity. */
  activityId?: number;
  /** Extra guard, for logsources only one product's events can satisfy. */
  product?: string;
  /** Sigma field → OCSF path(s). */
  fieldMap: Record<string, string>;
}

const PROCESS = "process.file.path";
const PARENT = "process.parent_process.file.path|actor.process.file.path";
const ACTOR_IMAGE = "actor.process.file.path|process.file.path";

const HTTP_FIELDS: Record<string, string> = {
  "c-uri": "http_request.url.url_string|http_request.url.path",
  "cs-uri": "http_request.url.url_string|http_request.url.path",
  "cs-uri-stem": "http_request.url.path",
  "cs-uri-query": "http_request.url.query_string|http_request.url.url_string",
  "c-uri-query": "http_request.url.query_string|http_request.url.url_string",
  "c-uri-extension": "http_request.url.path",
  "cs-method": "http_request.http_method",
  "sc-status": "http_response.code",
  "c-useragent": "http_request.user_agent",
  "cs-user-agent": "http_request.user_agent",
  "cs-referer": "http_request.referrer",
  "cs-host": "http_request.url.hostname|dst_endpoint.hostname",
  "c-ip": "src_endpoint.ip",
  "s-ip": "dst_endpoint.ip",
  "cs-username": "actor.user.name",
  "r-dns": "http_request.url.hostname|dst_endpoint.hostname",
};

export const OCSF_SIGMA_PROFILES: OcsfSigmaProfile[] = [
  {
    id: "process_creation",
    logsources: [{ category: "process_creation" }],
    classUid: 1007,
    activityId: 1, // Launch
    fieldMap: {
      Image: PROCESS,
      OriginalFileName: "process.file.name",
      CommandLine: "process.cmd_line",
      CurrentDirectory: "process.working_directory",
      ProcessId: "process.pid",
      ParentImage: PARENT,
      ParentCommandLine: "process.parent_process.cmd_line|actor.process.cmd_line",
      ParentProcessId: "process.parent_process.pid|actor.process.pid",
      User: "actor.user.name|process.user.name",
      IntegrityLevel: "process.integrity",
      Company: "process.file.company_name",
      Product: "process.file.product.name",
      Description: "process.file.desc",
      Computer: "device.hostname",
    },
  },
  {
    id: "file_event",
    logsources: [{ category: "file_event" }],
    classUid: 1001,
    activityId: 1, // Create
    fieldMap: {
      TargetFilename: "file.path",
      Image: ACTOR_IMAGE,
      User: "actor.user.name",
      Computer: "device.hostname",
    },
  },
  {
    id: "network_connection",
    logsources: [{ category: "network_connection" }],
    classUid: 4001,
    fieldMap: {
      Image: ACTOR_IMAGE,
      User: "actor.user.name",
      SourceIp: "src_endpoint.ip",
      SourcePort: "src_endpoint.port",
      SourceHostname: "src_endpoint.hostname",
      DestinationIp: "dst_endpoint.ip",
      DestinationPort: "dst_endpoint.port",
      DestinationHostname: "dst_endpoint.hostname",
      Protocol: "connection_info.protocol_name",
      Computer: "device.hostname",
    },
  },
  {
    id: "firewall",
    logsources: [{ category: "firewall" }],
    classUid: 4001,
    fieldMap: {
      src_ip: "src_endpoint.ip",
      src_port: "src_endpoint.port",
      dst_ip: "dst_endpoint.ip",
      dst_port: "dst_endpoint.port",
      action: "disposition|action",
      protocol: "connection_info.protocol_name",
    },
  },
  {
    id: "dns_query",
    logsources: [{ category: "dns_query" }, { category: "dns" }],
    classUid: 4003,
    fieldMap: {
      query: "query.hostname",
      QueryName: "query.hostname",
      record_type: "query.type",
      QueryType: "query.type",
      answer: "answers.rdata|answers",
      QueryResults: "answers.rdata|answers",
      Image: ACTOR_IMAGE,
      Computer: "device.hostname",
    },
  },
  {
    id: "http",
    logsources: [{ category: "webserver" }, { category: "proxy" }],
    classUid: 4002,
    fieldMap: HTTP_FIELDS,
  },
  {
    id: "aws_cloudtrail",
    logsources: [{ product: "aws", service: "cloudtrail" }],
    classUid: 6003,
    product: "cloudtrail",
    fieldMap: {
      eventName: "api.operation",
      eventSource: "api.service.name",
      "userIdentity.type": "actor.user.type",
      "userIdentity.arn": "actor.user.uid",
      "userIdentity.userName": "actor.user.name",
      "userIdentity.accountId": "actor.user.account.uid|cloud.account.uid",
      "userIdentity.sessionContext.sessionIssuer.type": "actor.session.issuer",
      sourceIPAddress: "src_endpoint.ip",
      userAgent: "http_request.user_agent",
      awsRegion: "cloud.region",
      errorCode: "api.response.error",
      errorMessage: "api.response.message",
      requestParameters: "api.request.data",
      responseElements: "api.response.data",
      recipientAccountId: "cloud.account.uid",
    },
  },
];

/** A rule's logsource asks for each part this one sets, and nothing it lacks. */
function servedBy(rule: SigmaLogsource, served: SigmaLogsource): boolean {
  return (["category", "product", "service"] as const).every((part) => {
    const want = rule[part]?.toLowerCase();
    const have = served[part]?.toLowerCase();
    // A served logsource that leaves a part open accepts any value of it, so
    // one process profile answers for Windows, Linux and macOS alike.
    if (!have) return true;
    return want === have;
  });
}

/** The OCSF profile that can run a rule, or null when OCSF has no class for it. */
export function ocsfProfileFor(rule: Pick<SigmaRule, "logsource">): OcsfSigmaProfile | null {
  return (
    OCSF_SIGMA_PROFILES.find((profile) =>
      profile.logsources.some((served) => servedBy(rule.logsource, served)),
    ) ?? null
  );
}

/** The guard as a Sigma search, so it compiles through the same field resolution. */
export function ocsfGuardSearch(profile: OcsfSigmaProfile): Record<string, unknown> {
  return {
    class_uid: profile.classUid,
    ...(profile.activityId !== undefined ? { activity_id: profile.activityId } : {}),
    ...(profile.product ? { "metadata.product.name|contains": profile.product } : {}),
  };
}
