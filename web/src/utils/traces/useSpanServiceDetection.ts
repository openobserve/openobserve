// Copyright 2026 OpenObserve Inc.
import type { InjectionKey, Ref } from "vue";
import type { Span } from "@/ts/interfaces/traces/span.types";

export type {
  ServiceDetectionRule,
  ServiceDetectionConfig,
} from "@/ts/interfaces/traces/serviceDetection.types";
import type { ServiceDetectionConfig } from "@/ts/interfaces/traces/serviceDetection.types";

export const TRACE_SERVICE_DETECTION_KEY: InjectionKey<Ref<ServiceDetectionConfig | null>> =
  Symbol("traceServiceDetection");

export function useSpanServiceDetection(_config?: unknown) {
  function resolveSpanIdentity(span: Span): string {
    const serviceName =
      span.infer_service_name || span.infer_service_system || span.service_name || "";

    return serviceName;
  }

  return { resolveSpanIdentity };
}
