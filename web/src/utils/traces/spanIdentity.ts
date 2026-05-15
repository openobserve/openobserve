// Copyright 2026 OpenObserve Inc.
import { type Span, SpanKind } from "@/ts/interfaces/traces/span.types";

export function resolveSpanIdentity(span: Span): string {
  const kind = span.span_kind;
  const attrs: Record<string, unknown> = span.attributes ?? {};
  const serviceName = span.service_name || "unknown";

  // Gate: inbound and in-process spans always represent "this service"
  if (
    !kind ||
    kind === SpanKind.SERVER ||
    kind === SpanKind.INTERNAL ||
    kind === SpanKind.UNSPECIFIED
  ) {
    return serviceName;
  }

  // CLIENT, PRODUCER, CONSUMER — resolve outbound dependency identity

  // Priority 1: explicit peer override
  if (attrs["peer.service"]) return String(attrs["peer.service"]);

  // Priority 2: database with specific schema
  if (attrs["db.system"] && attrs["db.name"])
    return `${attrs["db.system"]}:${attrs["db.name"]}`;

  // Priority 3: database technology only
  if (attrs["db.system"]) return String(attrs["db.system"]);

  // Priority 4: messaging broker + topic
  if (attrs["messaging.system"] && attrs["messaging.destination.name"])
    return `${attrs["messaging.system"]}:${attrs["messaging.destination.name"]}`;

  // Priority 5: messaging topic only
  if (attrs["messaging.destination.name"])
    return String(attrs["messaging.destination.name"]);

  // Priority 6: RPC framework + service
  if (attrs["rpc.system"] && attrs["rpc.service"])
    return `${attrs["rpc.system"]}:${attrs["rpc.service"]}`;

  // Priority 7: RPC framework only
  if (attrs["rpc.system"]) return String(attrs["rpc.system"]);

  // Priority 8: HTTP outbound host + path
  if (attrs["server.address"] && attrs["url.path"])
    return `${attrs["server.address"]}${attrs["url.path"]}`;

  // Priority 9: HTTP outbound host only
  if (attrs["server.address"]) return String(attrs["server.address"]);

  // Priority 10: fallback — calling service's own name
  return serviceName;
}
