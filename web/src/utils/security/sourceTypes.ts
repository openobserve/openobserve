// Copyright 2026 OpenObserve Inc.
//
// sourceTypes.ts — what a log stream actually is, decided from its fields.
//
// A SIEM cannot ask the operator to label every stream, and it must not guess
// from stream names: "prod-logs-3" says nothing, and a stream called "security"
// is often nginx. What a source cannot hide is its SHAPE. CloudTrail always
// carries eventName and userIdentity; Sysmon process creation always carries
// Image, CommandLine and ParentImage; a webserver always carries a method and a
// status. Those field sets are fingerprints, and they are what this file holds.
//
// Each entry ties three things together:
//   • the fingerprint, so a stream can be recognised
//   • the Sigma logsource, so detection rules written for that source apply
//     (https://sigmahq.io — the public corpus is ~3,100 rules keyed on exactly
//     this category/product/service triple)
//   • the OCSF class and a field map, so events from it can be shown in the same
//     columns as every other source
//
// Field names use `a|b` to mean "either spelling", because the same log arrives
// with different casing and nesting depending on the shipper.

import type { NormalizedEvent } from "./ocsf";

/** A value the sample row must carry for the fingerprint to hold. */
export interface ValueSignal {
  field: string;
  /** Matched case-insensitively against the value, as substring or equality. */
  any: string[];
}

export interface SourceType {
  id: string;
  label: string;
  vendor: string;
  /**
   * The Sigma logsource this stream satisfies. Rules declare the same triple, so
   * this is what decides which of the corpus can run against the stream.
   */
  sigma: { category?: string; product?: string; service?: string };
  /** OCSF class events from this source are mapped onto. */
  ocsfClass: number;
  /** Every one of these must be present. `a|b` accepts either spelling. */
  required: string[];
  /** Present-but-optional fields; each one raises confidence. */
  signals?: string[];
  /** Presence of any of these rules the source out. */
  absent?: string[];
  /** Values the sample must carry, for sources only distinguishable by content. */
  valueSignals?: ValueSignal[];
  /**
   * Ranking nudge for sources that are strict subsets of another. Generic
   * catch-alls sit below the specific sources they would otherwise tie with.
   */
  weight?: number;
  /** Raw field(s) per normalized column; the first non-empty one wins. */
  map: Partial<Record<keyof NormalizedEvent, string[]>>;
  /** Fixed values for this source, used where the log carries no field for it. */
  constants?: Partial<Record<keyof NormalizedEvent, string>>;
  /**
   * Fields whose mere PRESENCE means the event failed, for sources that report
   * failure by attaching an error rather than by carrying an outcome field.
   * CloudTrail is the archetype: an errorCode appears only on a denied call, and
   * its value ("AccessDenied") is a reason, not a verdict.
   */
  failureWhenPresent?: string[];
  /** True for sources that carry no security semantics of their own. */
  telemetryOnly?: boolean;
}

const TIME = ["_timestamp", "@timestamp", "timestamp", "time", "eventTime", "published"];

export const SOURCE_TYPES: SourceType[] = [
  // ── Already normalized ────────────────────────────────────────────────────
  {
    id: "ocsf_native",
    label: "OCSF (native)",
    vendor: "OCSF",
    sigma: { category: "application" },
    ocsfClass: 0,
    required: ["class_uid"],
    signals: ["severity_id", "activity_id", "metadata.version", "actor.user.name", "class_name"],
    weight: 1.3,
    map: {
      time: TIME,
      classUid: ["class_uid"],
      className: ["class_name"],
      activity: ["activity_name", "type_name"],
      severityId: ["severity_id", "severity"],
      statusId: ["status_id", "status"],
      actor: ["actor.user.name", "actor.user.uid"],
      actorId: ["actor.user.uid", "actor.user.email_addr"],
      srcIp: ["src_endpoint.ip"],
      srcPort: ["src_endpoint.port"],
      dstIp: ["dst_endpoint.ip"],
      dstPort: ["dst_endpoint.port"],
      host: ["device.hostname", "device.name"],
      process: ["actor.process.name", "process.name"],
      product: ["metadata.product.name"],
      vendor: ["metadata.product.vendor_name", "metadata.product.vendor"],
      operation: ["api.operation", "activity_name"],
      resource: ["resource.name", "api.service.name"],
      message: ["message", "raw_data"],
    },
  },

  // ── Cloud control planes ──────────────────────────────────────────────────
  {
    id: "aws_cloudtrail",
    label: "AWS CloudTrail",
    vendor: "Amazon Web Services",
    sigma: { product: "aws", service: "cloudtrail" },
    ocsfClass: 6003,
    required: ["eventName", "eventSource"],
    signals: [
      "userIdentity.type",
      "awsRegion",
      "sourceIPAddress",
      "eventID",
      "recipientAccountId",
      "userAgent",
    ],
    failureWhenPresent: ["errorCode", "errorMessage"],
    map: {
      time: ["eventTime", ...TIME],
      activity: ["eventName"],
      actor: ["userIdentity.userName", "userIdentity.arn", "userIdentity.principalId"],
      actorId: ["userIdentity.arn", "userIdentity.accountId"],
      srcIp: ["sourceIPAddress"],
      host: ["recipientAccountId"],
      operation: ["eventName"],
      resource: ["eventSource", "requestParameters.bucketName"],
      message: ["errorMessage", "eventName"],
    },
    constants: { product: "CloudTrail", vendor: "Amazon Web Services" },
  },
  {
    id: "aws_vpc_flow",
    label: "AWS VPC Flow Logs",
    vendor: "Amazon Web Services",
    sigma: { product: "aws", service: "vpcflow" },
    ocsfClass: 4001,
    required: ["srcaddr", "dstaddr"],
    signals: [
      "interface_id",
      "account_id",
      "packets",
      "bytes",
      "log_status",
      "action",
      "srcport",
      "dstport",
    ],
    map: {
      time: ["start", ...TIME],
      activity: ["action"],
      statusId: ["action"],
      srcIp: ["srcaddr"],
      srcPort: ["srcport"],
      dstIp: ["dstaddr"],
      dstPort: ["dstport"],
      host: ["interface_id"],
      operation: ["action"],
      resource: ["account_id"],
    },
    constants: { product: "VPC Flow Logs", vendor: "Amazon Web Services" },
  },
  {
    id: "azure_signin",
    label: "Microsoft Entra sign-ins",
    vendor: "Microsoft",
    sigma: { product: "azure", service: "signinlogs" },
    ocsfClass: 3002,
    required: ["properties.userPrincipalName|userPrincipalName|identity"],
    signals: [
      "resultType",
      "properties.ipAddress",
      "properties.appDisplayName",
      "category",
      "correlationId",
      "resultDescription",
    ],
    valueSignals: [{ field: "category", any: ["signin"] }],
    map: {
      time: ["createdDateTime", "properties.createdDateTime", ...TIME],
      activity: ["operationName", "category"],
      statusId: ["resultType", "properties.status.errorCode"],
      actor: ["properties.userPrincipalName", "userPrincipalName", "identity"],
      actorId: ["properties.userId", "userId"],
      srcIp: ["properties.ipAddress", "callerIpAddress"],
      host: ["properties.deviceDetail.displayName"],
      operation: ["operationName"],
      resource: ["properties.appDisplayName", "resourceId"],
      message: ["resultDescription"],
    },
    constants: { product: "Microsoft Entra ID", vendor: "Microsoft" },
  },
  {
    id: "azure_activity",
    label: "Azure Activity",
    vendor: "Microsoft",
    sigma: { product: "azure", service: "activitylogs" },
    ocsfClass: 6003,
    required: ["operationName", "resourceId"],
    signals: ["category", "resultSignature", "callerIpAddress", "correlationId", "subscriptionId"],
    absent: ["properties.userPrincipalName"],
    map: {
      time: TIME,
      activity: ["operationName"],
      statusId: ["resultType", "resultSignature"],
      actor: ["caller", "identity.claims.name"],
      srcIp: ["callerIpAddress"],
      operation: ["operationName"],
      resource: ["resourceId"],
      message: ["resultDescription", "properties.statusMessage"],
    },
    constants: { product: "Azure Activity", vendor: "Microsoft" },
  },
  {
    id: "gcp_audit",
    label: "Google Cloud Audit",
    vendor: "Google",
    sigma: { product: "gcp", service: "gcp.audit" },
    ocsfClass: 6003,
    required: ["protoPayload.methodName|protoPayload.serviceName"],
    signals: [
      "protoPayload.authenticationInfo.principalEmail",
      "resource.type",
      "logName",
      "insertId",
      "protoPayload.requestMetadata.callerIp",
    ],
    map: {
      time: ["receiveTimestamp", ...TIME],
      activity: ["protoPayload.methodName"],
      statusId: ["protoPayload.status.code"],
      actor: ["protoPayload.authenticationInfo.principalEmail"],
      srcIp: ["protoPayload.requestMetadata.callerIp"],
      operation: ["protoPayload.methodName"],
      resource: ["protoPayload.resourceName", "resource.type"],
      message: ["protoPayload.status.message"],
    },
    constants: { product: "Cloud Audit Logs", vendor: "Google" },
  },
  {
    id: "k8s_audit",
    label: "Kubernetes audit",
    vendor: "Kubernetes",
    sigma: { product: "kubernetes", service: "audit" },
    ocsfClass: 6003,
    required: ["verb", "objectRef.resource|objectRef.name"],
    signals: [
      "user.username",
      "responseStatus.code",
      "requestURI",
      "sourceIPs",
      "stage",
      "auditID",
    ],
    map: {
      time: ["requestReceivedTimestamp", ...TIME],
      activity: ["verb"],
      statusId: ["responseStatus.code"],
      actor: ["user.username"],
      actorId: ["user.uid"],
      srcIp: ["sourceIPs"],
      operation: ["verb"],
      resource: ["objectRef.resource", "requestURI"],
      message: ["responseStatus.reason", "responseStatus.message"],
    },
    constants: { product: "Kubernetes audit", vendor: "Kubernetes" },
  },
  {
    id: "github_audit",
    label: "GitHub audit",
    vendor: "GitHub",
    sigma: { product: "github", service: "audit" },
    ocsfClass: 6003,
    required: ["action", "actor"],
    signals: ["repo", "org", "actor_ip", "user_agent", "business"],
    map: {
      time: ["created_at", ...TIME],
      activity: ["action"],
      actor: ["actor"],
      srcIp: ["actor_ip"],
      operation: ["action"],
      resource: ["repo", "org"],
    },
    constants: { product: "GitHub", vendor: "GitHub" },
  },

  // ── Identity providers ────────────────────────────────────────────────────
  {
    id: "okta_system_log",
    label: "Okta System Log",
    vendor: "Okta",
    sigma: { product: "okta", service: "okta" },
    ocsfClass: 3002,
    required: ["eventType", "actor.alternateId|actor.id"],
    signals: [
      "outcome.result",
      "client.ipAddress",
      "displayMessage",
      "authenticationContext.externalSessionId",
      "client.geographicalContext.city",
    ],
    map: {
      time: ["published", ...TIME],
      activity: ["eventType", "displayMessage"],
      statusId: ["outcome.result"],
      actor: ["actor.alternateId", "actor.displayName"],
      actorId: ["actor.id"],
      srcIp: ["client.ipAddress"],
      host: ["client.device"],
      operation: ["eventType"],
      resource: ["target.displayName"],
      message: ["displayMessage", "outcome.reason"],
    },
    constants: { product: "Okta", vendor: "Okta" },
  },

  // ── Endpoint ──────────────────────────────────────────────────────────────
  {
    id: "windows_sysmon_process",
    label: "Sysmon process creation",
    vendor: "Microsoft",
    sigma: { category: "process_creation", product: "windows" },
    ocsfClass: 1007,
    required: ["Image", "CommandLine"],
    signals: [
      "ParentImage",
      "ParentCommandLine",
      "ProcessGuid",
      "User",
      "Hashes",
      "IntegrityLevel",
      "OriginalFileName",
    ],
    map: {
      time: ["UtcTime", ...TIME],
      activity: ["Image"],
      actor: ["User"],
      srcIp: ["SourceIp"],
      dstIp: ["DestinationIp"],
      host: ["Computer", "ComputerName", "hostname"],
      process: ["Image"],
      operation: ["CommandLine"],
      resource: ["ParentImage"],
      message: ["CommandLine"],
    },
    constants: { product: "Sysmon", vendor: "Microsoft" },
  },
  {
    id: "windows_security",
    label: "Windows Security log",
    vendor: "Microsoft",
    sigma: { product: "windows", service: "security" },
    ocsfClass: 3002,
    required: ["EventID|event_id"],
    signals: [
      "Channel",
      "Computer",
      "TargetUserName",
      "SubjectUserName",
      "LogonType",
      "Provider_Name",
      "IpAddress",
    ],
    absent: ["Image"],
    map: {
      time: ["SystemTime", "TimeCreated", ...TIME],
      activity: ["EventID", "event_id"],
      statusId: ["Status", "Keywords"],
      actor: ["TargetUserName", "SubjectUserName"],
      actorId: ["TargetUserSid", "SubjectUserSid"],
      srcIp: ["IpAddress", "WorkstationName"],
      host: ["Computer", "ComputerName"],
      process: ["ProcessName"],
      operation: ["EventID"],
      resource: ["TargetDomainName", "Channel"],
      message: ["Message", "RenderingInfo.Message"],
    },
    constants: { product: "Windows Security", vendor: "Microsoft" },
  },
  {
    id: "linux_auditd",
    label: "Linux auditd",
    vendor: "Linux",
    sigma: { product: "linux", service: "auditd" },
    ocsfClass: 1007,
    required: ["type", "auid|uid|syscall"],
    signals: ["exe", "comm", "syscall", "key", "ppid", "success", "tty"],
    valueSignals: [
      { field: "type", any: ["syscall", "execve", "user_auth", "user_acct", "path", "cred_"] },
    ],
    map: {
      time: TIME,
      activity: ["type"],
      statusId: ["success", "res"],
      actor: ["auid", "uid", "acct"],
      host: ["node", "hostname", "host"],
      process: ["exe", "comm"],
      operation: ["syscall", "type"],
      resource: ["key", "name"],
      message: ["proctitle", "msg"],
    },
    constants: { product: "auditd", vendor: "Linux" },
  },
  {
    id: "linux_auth",
    label: "Linux authentication (sshd, sudo)",
    vendor: "Linux",
    sigma: { product: "linux", service: "auth" },
    ocsfClass: 3002,
    required: ["message|msg"],
    signals: ["program", "SYSLOG_IDENTIFIER", "hostname", "facility", "unit", "_SYSTEMD_UNIT"],
    valueSignals: [
      {
        field: "program|SYSLOG_IDENTIFIER|unit|_SYSTEMD_UNIT|ident",
        any: ["sshd", "sudo", "su", "login", "polkit"],
      },
    ],
    weight: 1.1,
    map: {
      time: TIME,
      activity: ["program", "SYSLOG_IDENTIFIER"],
      host: ["hostname", "host", "_HOSTNAME"],
      process: ["program", "SYSLOG_IDENTIFIER"],
      operation: ["program"],
      message: ["message", "msg"],
    },
    constants: { product: "syslog", vendor: "Linux" },
  },

  // ── Network ───────────────────────────────────────────────────────────────
  {
    id: "webserver_access",
    label: "Web server access log",
    vendor: "Web server",
    sigma: { category: "webserver" },
    ocsfClass: 4002,
    required: [
      "status|sc-status|http.response.status_code|status_code|response_code",
      "method|cs-method|http.request.method|request_method|verb",
    ],
    signals: [
      "path",
      "uri",
      "url",
      "request",
      "remote_addr",
      "c-ip",
      "client_ip",
      "user_agent",
      "referer",
      "bytes_sent",
      "body_bytes_sent",
      "host",
    ],
    map: {
      time: TIME,
      activity: ["method", "cs-method", "http.request.method", "request_method", "verb"],
      statusId: [
        "status",
        "sc-status",
        "http.response.status_code",
        "status_code",
        "response_code",
      ],
      actor: ["remote_user", "cs-username", "user"],
      srcIp: ["remote_addr", "c-ip", "client_ip", "src_ip", "source.ip"],
      dstIp: ["server_addr", "s-ip", "destination.ip"],
      host: ["host", "server_name", "cs-host", "hostname"],
      operation: ["method", "cs-method", "http.request.method", "request_method"],
      resource: ["path", "uri", "cs-uri-stem", "url", "request"],
      message: ["request", "url", "uri"],
    },
    constants: { product: "Web server", vendor: "Web server" },
  },
  {
    id: "proxy_access",
    label: "Proxy access log",
    vendor: "Proxy",
    sigma: { category: "proxy" },
    ocsfClass: 4002,
    required: ["c-uri|cs-uri|cs-host", "cs-method|c-method"],
    signals: [
      "c-useragent",
      "sc-status",
      "cs-bytes",
      "sc-bytes",
      "cs-username",
      "x-virus-id",
      "cs-categories",
    ],
    map: {
      time: TIME,
      activity: ["cs-method", "c-method"],
      statusId: ["sc-status"],
      actor: ["cs-username", "c-username"],
      srcIp: ["c-ip", "src_ip"],
      dstIp: ["s-ip", "cs-host"],
      host: ["cs-host"],
      operation: ["cs-method"],
      resource: ["c-uri", "cs-uri"],
      message: ["c-uri", "cs-categories"],
    },
    constants: { product: "Proxy", vendor: "Proxy" },
  },
  {
    id: "dns_query",
    label: "DNS query log",
    vendor: "DNS",
    sigma: { category: "dns_query" },
    ocsfClass: 4003,
    required: ["query|dns.question.name|question_name|query_name|qname"],
    signals: [
      "query_type",
      "qtype",
      "dns.question.type",
      "rcode",
      "response_code",
      "answers",
      "client_ip",
      "dns.answers.data",
    ],
    map: {
      time: TIME,
      activity: ["query_type", "qtype", "dns.question.type"],
      statusId: ["rcode", "response_code", "dns.response.code"],
      srcIp: ["client_ip", "source.ip", "src_ip", "id.orig_h"],
      dstIp: ["server_ip", "destination.ip", "dst_ip", "id.resp_h"],
      host: ["hostname", "host"],
      operation: ["query_type", "qtype"],
      resource: ["query", "dns.question.name", "question_name", "query_name", "qname"],
      message: ["query", "dns.question.name", "qname"],
    },
    constants: { product: "DNS", vendor: "DNS" },
  },
  {
    id: "firewall",
    label: "Firewall log",
    vendor: "Firewall",
    sigma: { category: "firewall" },
    ocsfClass: 4001,
    required: [
      "src_ip|source.ip|src|srcip|source_address",
      "dst_ip|destination.ip|dst|dstip|destination_address",
    ],
    signals: [
      "action",
      "protocol",
      "proto",
      "src_port",
      "dst_port",
      "rule",
      "policy_id",
      "interface",
    ],
    absent: ["cs-method", "query"],
    map: {
      time: TIME,
      activity: ["action"],
      statusId: ["action"],
      srcIp: ["src_ip", "source.ip", "src", "srcip", "source_address"],
      srcPort: ["src_port", "source.port", "sport", "srcport"],
      dstIp: ["dst_ip", "destination.ip", "dst", "dstip", "destination_address"],
      dstPort: ["dst_port", "destination.port", "dport", "dstport"],
      host: ["hostname", "device_name", "host"],
      operation: ["action"],
      resource: ["rule", "policy_id", "rule_name"],
      message: ["msg", "message"],
    },
    constants: { product: "Firewall", vendor: "Firewall" },
  },
  {
    id: "zeek_conn",
    label: "Zeek connection log",
    vendor: "Zeek",
    sigma: { product: "zeek", service: "conn" },
    ocsfClass: 4001,
    required: ["id.orig_h", "id.resp_h"],
    signals: ["uid", "proto", "service", "duration", "orig_bytes", "resp_bytes", "conn_state"],
    map: {
      time: ["ts", ...TIME],
      activity: ["service", "proto"],
      statusId: ["conn_state"],
      srcIp: ["id.orig_h"],
      srcPort: ["id.orig_p"],
      dstIp: ["id.resp_h"],
      dstPort: ["id.resp_p"],
      operation: ["proto"],
      resource: ["service"],
      message: ["conn_state"],
    },
    constants: { product: "Zeek", vendor: "Zeek" },
  },
  {
    id: "ids_alert",
    label: "IDS/IPS alert",
    vendor: "IDS",
    sigma: { product: "suricata" },
    ocsfClass: 2004,
    required: ["alert.signature|signature|rule.name"],
    signals: [
      "alert.category",
      "alert.severity",
      "src_ip",
      "dest_ip",
      "event_type",
      "sid",
      "rule.id",
    ],
    map: {
      time: TIME,
      activity: ["alert.signature", "signature", "rule.name"],
      severityId: ["alert.severity", "severity"],
      srcIp: ["src_ip", "source.ip"],
      srcPort: ["src_port"],
      dstIp: ["dest_ip", "dst_ip", "destination.ip"],
      dstPort: ["dest_port", "dst_port"],
      host: ["host", "sensor"],
      operation: ["alert.action", "action"],
      resource: ["alert.category", "rule.id", "sid"],
      message: ["alert.signature", "signature", "rule.name"],
    },
    constants: { product: "IDS", vendor: "IDS" },
  },

  // ── Generic fallbacks ─────────────────────────────────────────────────────
  {
    id: "kubernetes_container",
    label: "Kubernetes container logs",
    vendor: "Kubernetes",
    sigma: { product: "kubernetes" },
    ocsfClass: 1008,
    required: ["kubernetes.pod_name|kubernetes_pod_name|k8s.pod.name|kubernetes.pod|pod_name"],
    signals: ["kubernetes.namespace_name", "kubernetes.container_name", "log", "message", "stream"],
    weight: 0.7,
    telemetryOnly: true,
    map: {
      time: TIME,
      host: ["kubernetes.pod_name", "kubernetes_pod_name", "k8s.pod.name", "pod_name"],
      process: ["kubernetes.container_name", "container_name"],
      resource: ["kubernetes.namespace_name", "namespace"],
      message: ["log", "message", "msg", "body"],
    },
    constants: { product: "Kubernetes", vendor: "Kubernetes" },
  },
  {
    id: "syslog_generic",
    label: "Syslog",
    vendor: "Syslog",
    sigma: { product: "linux", service: "syslog" },
    ocsfClass: 1008,
    required: ["message|msg"],
    signals: [
      "hostname",
      "facility",
      "severity",
      "program",
      "appname",
      "priority",
      "SYSLOG_IDENTIFIER",
    ],
    weight: 0.6,
    telemetryOnly: true,
    map: {
      time: TIME,
      activity: ["program", "appname", "SYSLOG_IDENTIFIER"],
      severityId: ["severity", "level", "log_level"],
      host: ["hostname", "host", "_HOSTNAME"],
      process: ["program", "appname", "SYSLOG_IDENTIFIER"],
      operation: ["facility"],
      message: ["message", "msg"],
    },
    constants: { product: "syslog", vendor: "Syslog" },
  },
  {
    id: "application_log",
    label: "Application logs",
    vendor: "Application",
    sigma: {},
    ocsfClass: 1008,
    required: ["message|msg|log|body"],
    signals: [
      "level",
      "log_level",
      "severity_text",
      "logger",
      "service",
      "service_name",
      "trace_id",
      "span_id",
    ],
    weight: 0.4,
    telemetryOnly: true,
    map: {
      time: TIME,
      severityId: ["level", "log_level", "severity_text", "severity"],
      host: ["host", "hostname", "service", "service_name"],
      process: ["logger", "service", "service_name"],
      resource: ["trace_id"],
      message: ["message", "msg", "log", "body"],
    },
    constants: { product: "Application", vendor: "Application" },
  },
];

export const SOURCE_TYPE_BY_ID = new Map(SOURCE_TYPES.map((s) => [s.id, s]));

/** A human-readable Sigma logsource, e.g. `product=aws service=cloudtrail`. */
export function sigmaLogsourceLabel(sigma: SourceType["sigma"]): string {
  const parts = [
    sigma.category ? `category=${sigma.category}` : "",
    sigma.product ? `product=${sigma.product}` : "",
    sigma.service ? `service=${sigma.service}` : "",
  ].filter(Boolean);
  return parts.join(" ");
}
