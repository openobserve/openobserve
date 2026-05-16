// Copyright 2026 OpenObserve Inc.
import { type Span, SpanKind } from "@/ts/interfaces/traces/span.types";
import {
  SPAN_KIND_MAP,
} from "@/utils/traces/constants";


export function getServiceName(span: Span): string {
  const attrs: Record<string, unknown> = span ?? {};

  // Top most priority
  // if(attrs["peer_service"]) return String(attrs["peer_service"]);


  // 1. FaaS
  // const faasName = attrs["faas_invoked_name"];
  // const faasTrigger = attrs["faas_trigger"];
  // if (faasName) {
  //   const provider = attrs["faas_invoked_provider"];
  //   return provider ? `${provider}/${faasName}` : String(faasName);
  // }
  // if (faasTrigger) return String(faasTrigger);

  // 2. GraphQL
  // const gqlOpType = attrs["graphql_operation_type"];
  // if (gqlOpType) {
  //   const gqlOpName = attrs["graphql_operation_name"];
  //   return gqlOpName ? String(gqlOpName) : String(gqlOpType);
  // }

  // 3. Cloud Storage
  // const rpcSystem = attrs["rpc_system"] || attrs['rpc_system_name'];
  // if (rpcSystem === "aws-api" && rpcService) {
  //   const label = AWS_STORAGE_SERVICES[rpcService] ?? `AWS ${rpcService}`;
  //   return rpcMethod ? `${label}: ${rpcMethod}` : label;
  // }
  // if (serverAddress.endsWith(".amazonaws.com"))
  //   return `AWS ${serverAddress.split(".")[0]}`;
  // if (serverAddress.endsWith(".googleapis.com")) return "Google Cloud Storage";
  // if (serverAddress.endsWith(".blob.core.windows.net"))
  //   return "Azure Blob Storage";
  // if (rpcSystem) {
  //   let rpcService = "";
  //   if(attrs["rpc_service"]) rpcService = String(attrs["rpc_service"]);
  //   if(attrs["peer_rpc_service"]) rpcService = String(attrs["peer_rpc_service"]);
  //   if(attrs["rpc_system_name"]) rpcService = String(attrs["rpc_system_name"]);
  //   return rpcService;
  // }

  // 4. Cache  +  5. Database
  const dbSystem = attrs["db_system"] || attrs['db_system_name'];
  if (dbSystem) {
    let dbService = "";
    if(attrs["db_name"]) dbService = String(attrs["db_name"]);
    if(attrs["peer_host_name"]) dbService = String(attrs["peer_host_name"]);
    if(attrs["db_system_name"]) dbService = String(attrs["db_system_name"]);
    if(attrs["db_system"]) dbService = String(attrs["db_system"]);
    return dbService;
  }

  // 6. Messaging
  const messagingSystem = attrs["messaging_system"];
  if (messagingSystem) {
    let msgService = "";
    if(attrs["messaging_system"]) msgService = String(attrs["messaging_system"]);
    if(attrs["peer_messaging_system"]) msgService = String(attrs["peer_messaging_system"]);
    return msgService;
  }

  // 9. Fallback
  return span.service_name || "";
}

export function resolveSpanIdentity(span: Span): string {
  const kind = SPAN_KIND_MAP[String(span.span_kind)];
  let serviceName = span.service_name || "unknown";

  // Gate: inbound and in-process spans always represent "this service"
  if (
    !kind ||
    kind === SpanKind.SERVER ||
    kind === SpanKind.INTERNAL ||
    kind === SpanKind.UNSPECIFIED
  ) {
    return serviceName;
  }

  let _serviceName = getServiceName(span);
  if(_serviceName) serviceName = _serviceName;

  // Priority 10: fallback — calling service's own name
  return serviceName;
}
