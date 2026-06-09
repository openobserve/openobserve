// Copyright 2026 OpenObserve Inc.
import type { InjectionKey, Ref } from "vue";
import type { Span } from "@/ts/interfaces/traces/span.types";
import { SPAN_KIND_MAP } from "@/utils/traces/constants";

export type {
  ServiceDetectionRule,
  ServiceDetectionConfig,
} from "@/ts/interfaces/traces/serviceDetection.types";
import type { ServiceDetectionConfig } from "@/ts/interfaces/traces/serviceDetection.types";

export const TRACE_SERVICE_DETECTION_KEY: InjectionKey<
  Ref<ServiceDetectionConfig | null>
> = Symbol("traceServiceDetection");

export function useSpanServiceDetection(
  config: Ref<ServiceDetectionConfig | null>,
) {
  function getServiceName(span: Span): string {
    if (!config.value) return span.service_name || "";

    const attrs: Record<string, unknown> = span as unknown as Record<string, unknown>;

    for (const rule of config.value.rules) {
      let baseValue: string | undefined;
      for (const attr of rule.attributes) {
        if (attrs[attr] != null) {
          baseValue = String(attrs[attr]);
          break;
        }
      }
      if (!baseValue) continue;

      for (const sub of rule.sub_attributes ?? []) {
        if (attrs[sub] != null) return String(attrs[sub]);
      }

      return baseValue;
    }

    return span.service_name || "";
  }

  function resolveSpanIdentity(span: Span): string {
    const serviceName = span.infer_service_name || span.infer_service_system || span.service_name || "unknown";

    return serviceName;
  }

  return { resolveSpanIdentity };
}
