// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Source types as the server's catalog sends them, display and field-map parts only, for specs.

import type { SourceType } from "@/services/securitySources";

export const SOURCE_TYPES_FIXTURE: SourceType[] = [
  {
    id: "ocsf_native",
    label: "OCSF (native)",
    vendor: "OCSF",
    sigma: {
      category: "application",
    },
    ocsfClass: 0,
    map: {
      time: ["_timestamp", "@timestamp", "timestamp", "time", "eventTime", "published"],
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
      host: ["device.hostname", "device.name", "http_request.url.hostname"],
      process: [
        "process.file.name",
        "process.name",
        "actor.process.name",
        "actor.process.file.name",
      ],
      product: ["metadata.product.name"],
      vendor: ["metadata.product.vendor_name", "metadata.product.vendor"],
      operation: ["api.operation", "http_request.http_method", "activity_name"],
      resource: [
        "resource.name",
        "api.service.name",
        "http_request.url.path",
        "query.hostname",
        "file.path",
        "process.file.path",
      ],
      message: [
        "message",
        "finding_info.title",
        "process.cmd_line",
        "http_request.url.url_string",
        "query.hostname",
        "raw_data",
      ],
    },
    ocsfStatusFields: ["status_id"],
  },
  {
    id: "aws_cloudtrail",
    label: "AWS CloudTrail",
    vendor: "Amazon Web Services",
    sigma: {
      product: "aws",
      service: "cloudtrail",
    },
    ocsfClass: 6003,
    map: {
      time: [
        "eventTime",
        "_timestamp",
        "@timestamp",
        "timestamp",
        "time",
        "eventTime",
        "published",
      ],
      activity: ["eventName"],
      actor: ["userIdentity.userName", "userIdentity.arn", "userIdentity.principalId"],
      actorId: ["userIdentity.arn", "userIdentity.accountId"],
      srcIp: ["sourceIPAddress"],
      operation: ["eventName"],
      resource: ["eventSource", "requestParameters.bucketName"],
      message: ["errorMessage", "eventName"],
    },
    constants: {
      product: "CloudTrail",
      vendor: "Amazon Web Services",
    },
    failureWhenPresent: ["errorCode", "errorMessage"],
  },
  {
    id: "aws_vpc_flow",
    label: "AWS VPC Flow Logs",
    vendor: "Amazon Web Services",
    sigma: {
      product: "aws",
      service: "vpcflow",
    },
    ocsfClass: 4001,
    map: {
      time: ["start", "_timestamp", "@timestamp", "timestamp", "time", "eventTime", "published"],
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
    constants: {
      product: "VPC Flow Logs",
      vendor: "Amazon Web Services",
    },
  },
  {
    id: "k8s_audit",
    label: "Kubernetes audit",
    vendor: "Kubernetes",
    sigma: {
      product: "kubernetes",
      service: "audit",
    },
    sigmaAliases: [
      {
        category: "application",
        product: "kubernetes",
        service: "audit",
      },
    ],
    ocsfClass: 6003,
    map: {
      time: [
        "requestReceivedTimestamp",
        "_timestamp",
        "@timestamp",
        "timestamp",
        "time",
        "eventTime",
        "published",
      ],
      activity: ["verb"],
      statusId: ["responseStatus.code"],
      actor: ["user.username"],
      actorId: ["user.uid"],
      srcIp: ["sourceIPs"],
      operation: ["verb"],
      resource: ["objectRef.resource", "requestURI"],
      message: ["responseStatus.reason", "responseStatus.message"],
    },
    constants: {
      product: "Kubernetes audit",
      vendor: "Kubernetes",
    },
  },
  {
    id: "okta_system_log",
    label: "Okta System Log",
    vendor: "Okta",
    sigma: {
      product: "okta",
      service: "okta",
    },
    ocsfClass: 3002,
    map: {
      time: [
        "published",
        "_timestamp",
        "@timestamp",
        "timestamp",
        "time",
        "eventTime",
        "published",
      ],
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
    constants: {
      product: "Okta",
      vendor: "Okta",
    },
  },
  {
    id: "windows_sysmon_process",
    label: "Sysmon process creation",
    vendor: "Microsoft",
    sigma: {
      category: "process_creation",
      product: "windows",
    },
    ocsfClass: 1007,
    map: {
      time: ["UtcTime", "_timestamp", "@timestamp", "timestamp", "time", "eventTime", "published"],
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
    constants: {
      product: "Sysmon",
      vendor: "Microsoft",
    },
  },
  {
    id: "windows_security",
    label: "Windows Security log",
    vendor: "Microsoft",
    sigma: {
      product: "windows",
      service: "security",
    },
    ocsfClass: 3002,
    map: {
      time: [
        "SystemTime",
        "TimeCreated",
        "_timestamp",
        "@timestamp",
        "timestamp",
        "time",
        "eventTime",
        "published",
      ],
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
    constants: {
      product: "Windows Security",
      vendor: "Microsoft",
    },
    failureWhen: {
      field: "EventID|event_id",
      codes: [4625, 4740, 4771],
      statusCodes: [4776],
      status: "Status|status",
      keywords: "Keywords",
    },
  },
  {
    id: "linux_auth",
    label: "Linux authentication (sshd, sudo)",
    vendor: "Linux",
    sigma: {
      product: "linux",
      service: "auth",
    },
    sigmaAliases: [
      {
        product: "linux",
        service: "sshd",
      },
      {
        product: "linux",
        service: "sudo",
      },
    ],
    ocsfClass: 3002,
    map: {
      time: ["_timestamp", "@timestamp", "timestamp", "time", "eventTime", "published"],
      activity: ["program", "SYSLOG_IDENTIFIER"],
      host: ["hostname", "host", "_HOSTNAME"],
      process: ["program", "SYSLOG_IDENTIFIER"],
      operation: ["program"],
      message: ["message", "msg"],
    },
    constants: {
      product: "syslog",
      vendor: "Linux",
    },
  },
  {
    id: "webserver_access",
    label: "Web server access log",
    vendor: "Web server",
    sigma: {
      category: "webserver",
    },
    ocsfClass: 4002,
    map: {
      time: ["_timestamp", "@timestamp", "timestamp", "time", "eventTime", "published"],
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
    constants: {
      product: "Web server",
      vendor: "Web server",
    },
  },
  {
    id: "ids_alert",
    label: "IDS/IPS alert",
    vendor: "IDS",
    sigma: {
      product: "suricata",
    },
    ocsfClass: 2004,
    map: {
      time: ["_timestamp", "@timestamp", "timestamp", "time", "eventTime", "published"],
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
    constants: {
      product: "IDS",
      vendor: "IDS",
    },
  },
  {
    id: "syslog_generic",
    label: "Syslog",
    vendor: "Syslog",
    sigma: {
      product: "linux",
      service: "syslog",
    },
    ocsfClass: 1008,
    map: {
      time: ["_timestamp", "@timestamp", "timestamp", "time", "eventTime", "published"],
      activity: ["program", "appname", "SYSLOG_IDENTIFIER"],
      severityId: ["severity", "level", "log_level"],
      host: ["hostname", "host", "_HOSTNAME"],
      process: ["program", "appname", "SYSLOG_IDENTIFIER"],
      operation: ["facility"],
      message: ["message", "msg"],
    },
    constants: {
      product: "syslog",
      vendor: "Syslog",
    },
    telemetryOnly: true,
  },
  {
    id: "application_log",
    label: "Application logs",
    vendor: "Application",
    sigma: {},
    ocsfClass: 1008,
    map: {
      time: ["_timestamp", "@timestamp", "timestamp", "time", "eventTime", "published"],
      severityId: ["level", "log_level", "severity_text", "severity"],
      host: ["host", "hostname", "service", "service_name"],
      process: ["logger", "service", "service_name"],
      resource: ["trace_id"],
      message: ["message", "msg", "log", "body"],
    },
    constants: {
      product: "Application",
      vendor: "Application",
    },
    telemetryOnly: true,
  },
];

export const SOURCE_TYPE_BY_ID = new Map(SOURCE_TYPES_FIXTURE.map((s) => [s.id, s]));
