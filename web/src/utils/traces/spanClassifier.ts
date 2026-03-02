/**
 * Span Category Classifier
 * Detects DB, external HTTP, RPC, and messaging spans using OTEL semantic conventions.
 * Reference: https://opentelemetry.io/docs/specs/semconv/db/database-spans/
 *            https://opentelemetry.io/docs/specs/semconv/general/trace/
 */

export type SpanCategory =
  | "db"
  | "external_http"
  | "external_rpc"
  | "messaging"
  | "default";

const CLIENT_KINDS = new Set(["client", "Client", "CLIENT", "1"]);
const PRODUCER_CONSUMER_KINDS = new Set([
  "producer",
  "Producer",
  "PRODUCER",
  "consumer",
  "Consumer",
  "CONSUMER",
  "3",
  "4",
]);

/**
 * Classify a span into a semantic category based on span_kind and OTEL attributes.
 * All attribute lookups are case-insensitive to handle variations across SDKs.
 */
export function classifySpan(span: any): SpanCategory {
  const kind = span.spanKind ?? span.span_kind ?? "";
  const attrs = span.attributes ?? span.attrs ?? {};

  if (CLIENT_KINDS.has(kind)) {
    // DB span: has db.system or db.name (stable semconv) or older db.type
    if (
      attrs["db_system"] != null ||
      attrs["db_name"] != null ||
      attrs["db_type"] != null
    ) {
      return "db";
    }

    // External HTTP: has http_url, url_full, or http_method (stable semconv)
    if (
      attrs["http_url"] != null ||
      attrs["url_full"] != null ||
      (attrs["http_method"] != null && attrs["http_scheme"] != null)
    ) {
      return "external_http";
    }

    // RPC: has rpc_system
    if (attrs["rpc_system"] != null) {
      return "external_rpc";
    }
  }

  // Messaging: PRODUCER or CONSUMER kind with messaging_system
  if (
    PRODUCER_CONSUMER_KINDS.has(kind) &&
    attrs["messaging_system"] != null
  ) {
    return "messaging";
  }

  return "default";
}

/**
 * Get the icon name for a span category_
 */
export function getSpanCategoryIcon(category: SpanCategory): string {
  switch (category) {
    case "db":
      return "storage";
    case "external_http":
      return "cloud";
    case "external_rpc":
      return "settings_ethernet";
    case "messaging":
      return "swap_horiz";
    default:
      return "";
  }
}

/**
 * Get the color for a span category.
 */
export function getSpanCategoryColor(category: SpanCategory): string {
  switch (category) {
    case "db":
      return "#795548"; // brown — database
    case "external_http":
      return "#0288D1"; // distinct blue — external HTTP
    case "external_rpc":
      return "#00796B"; // teal — RPC
    case "messaging":
      return "#7B1FA2"; // purple — messaging
    default:
      return "";
  }
}

/**
 * Get the human-readable label for a span category.
 */
export function getSpanCategoryLabel(category: SpanCategory): string {
  switch (category) {
    case "db":
      return "Database";
    case "external_http":
      return "External HTTP";
    case "external_rpc":
      return "External RPC";
    case "messaging":
      return "Messaging";
    default:
      return "";
  }
}

/**
 * Extract the most relevant DB attributes from a span for display.
 */
export function extractDbAttributes(attrs: Record<string, any>): Record<string, any> {
  const keys = [
    "db_system",
    "db_name",
    "db_statement",
    "db_operation",
    "db_user",
    "net_peer_name",
    "net_peer_port",
    "server_address",
    "server_port",
  ];
  return extractKeys(attrs, keys);
}

/**
 * Extract the most relevant HTTP attributes from a span for display.
 */
export function extractHttpAttributes(attrs: Record<string, any>): Record<string, any> {
  const keys = [
    "http_method",
    "http_request_method",
    "http_url",
    "url_full",
    "http_status_code",
    "http_response_status_code",
    "net_peer_name",
    "server_address",
    "server_port",
  ];
  return extractKeys(attrs, keys);
}

function extractKeys(
  attrs: Record<string, any>,
  keys: string[],
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of keys) {
    if (attrs[key] != null) {
      result[key] = attrs[key];
    }
  }
  return result;
}
