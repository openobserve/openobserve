import type { I18nKey } from "@/types/i18n";

export type DisplaySource =
  | "trace"
  | "alias:rename"
  | "alias:rum_service"
  | "alias:k8s_workload"
  | "detection"
  | "detection_ambiguous";

export interface ServiceDisplayFields {
  display_name?: string;
  display_source?: DisplaySource;
  display_candidates?: string[];
  display_qualifier?: string;
}

/** A service as pickers carry it: `key` is what requests send, `display` is only shown. */
export interface ServiceRef {
  key: string;
  display: string;
}

export interface ServiceRefRow extends ServiceDisplayFields {
  service_name: string;
}

export function qualifiedName(name: string, qualifier?: string | null): string {
  return qualifier ? `${name} · ${qualifier}` : name;
}

export function serviceRefFrom(row: ServiceRefRow): ServiceRef {
  return {
    key: row.service_name,
    display: qualifiedName(row.display_name || row.service_name, row.display_qualifier),
  };
}

export function showsDetectedAs(key: string, display?: string | null): boolean {
  return !!display && display.toLowerCase() !== key.toLowerCase();
}

export function isTraceBacked(source?: string | null): boolean {
  return source === "trace" || !!source?.startsWith("alias:");
}

const PLACEHOLDER = /^unknown_service(:.*)?$/;

/** A name standing in for a missing service.name: the SDK default, the ingest default "default", or none at all. */
export function isPlaceholderService(key: string): boolean {
  return key === "" || key === "default" || isSdkPlaceholder(key);
}

export function isSdkPlaceholder(key: string): boolean {
  return PLACEHOLDER.test(key);
}

/** The line under a placeholder name: an SDK placeholder, or no service name sent at all. */
export function placeholderLineKey(key: string): I18nKey | null {
  if (isSdkPlaceholder(key)) return "serviceVersions.names.placeholder";
  return isPlaceholderService(key) ? "serviceVersions.names.noServiceName" : null;
}

/** The label props for a row carrying the display fields. */
export function serviceLabelProps(row: ServiceRefRow) {
  return {
    serviceKey: row.service_name,
    displayName: row.display_name ?? null,
    displaySource: row.display_source ?? null,
    candidates: row.display_candidates ?? null,
    qualifier: row.display_qualifier ?? null,
  };
}

/** The display fields of a row without its other columns, for records derived from it. */
export function displayFieldsOf(row: ServiceDisplayFields): ServiceDisplayFields {
  const out: ServiceDisplayFields = {};
  if (row.display_name) out.display_name = row.display_name;
  if (row.display_source) out.display_source = row.display_source;
  if (row.display_candidates?.length) out.display_candidates = row.display_candidates;
  if (row.display_qualifier) out.display_qualifier = row.display_qualifier;
  return out;
}

/** The label props for a bare key with the display fields found for it, if any. */
export function labelPropsForKey(key: string, row?: ServiceDisplayFields | null) {
  return serviceLabelProps({ service_name: key, ...displayFieldsOf(row ?? {}) });
}

export interface ServiceOptionParts {
  /** What the option shows: the display name with its qualifier. */
  display: string;
  note: "detected" | "ambiguous" | null;
  count: number;
}

/** How a picker option for `key` reads; the option's value always stays `key`. */
export function serviceOptionParts(
  key: string,
  row?: ServiceDisplayFields | null,
): ServiceOptionParts {
  const display = qualifiedName(row?.display_name || key, row?.display_qualifier);
  const count = row?.display_candidates?.length ?? 0;
  if (row?.display_source === "detection_ambiguous" && count) {
    return { display, note: "ambiguous", count };
  }
  return { display, note: showsDetectedAs(key, row?.display_name) ? "detected" : null, count };
}

/** The correlation drawer's display props from a `_correlate` response; `serviceName` stays the key. */
export function correlationDisplayProps(row: ServiceRefRow) {
  return {
    displayServiceName: row.display_name || undefined,
    serviceDisplay: {
      display_source: row.display_source,
      display_candidates: row.display_candidates,
      display_qualifier: row.display_qualifier,
    },
  };
}
