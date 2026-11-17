// Copyright 2026 OpenObserve Inc.
//
// fieldGroups.ts — the Events field sidebar's grouping of a schema by OCSF object.

// Groups follow OCSF objects, so a field sits where the OCSF schema puts it.
const FIELD_GROUPS: [RegExp, string][] = [
  [
    /^(class_uid|class_name|category_uid|category_name|activity_id|activity_name|type_uid|type_name|severity_id|severity|level|status|status_code|status_id|status_detail|message|time|start_time|end_time|duration|count)$/,
    "event",
  ],
  [/^(actor|user|session)[._]/, "actor"],
  [/^(src_endpoint|src)[._]/, "src"],
  [/^(dst_endpoint|dst)[._]/, "dst"],
  [/^(connection_info|traffic|network_traffic|tls|proxy)[._]/, "network"],
  [/^(http_request|http_response|url|web_resources)[._]/, "http"],
  [/^(process|file|module|registry_key)[._]/, "process"],
  [/^(cloud|api|resources)[._]/, "cloud"],
  [/^(finding_info|finding|attacks|vulnerabilities|malware|observables)[._]/, "finding"],
  [/^device[._]/, "device"],
  [/^metadata[._]/, "metadata"],
];
const FIELD_GROUP_ORDER = [
  "event",
  "actor",
  "src",
  "dst",
  "network",
  "http",
  "process",
  "cloud",
  "finding",
  "device",
  "metadata",
  "other",
];

/** Schema fields in OCSF object groups, in reading order; unmatched fields go last under "other". */
export function groupFields<F extends { name: string }>(
  fields: F[],
): { group: string; fields: F[] }[] {
  const groups: Record<string, F[]> = {};
  for (const f of fields) {
    const group = FIELD_GROUPS.find(([re]) => re.test(f.name))?.[1] ?? "other";
    (groups[group] ??= []).push(f);
  }
  return FIELD_GROUP_ORDER.filter((g) => groups[g]?.length).map((g) => ({
    group: g,
    fields: groups[g],
  }));
}
