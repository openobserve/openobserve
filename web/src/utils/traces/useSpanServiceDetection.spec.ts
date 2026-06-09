// Copyright 2026 OpenObserve Inc.
import { ref } from "vue";
import { describe, expect, it, afterEach } from "vitest";
import type { ServiceDetectionConfig } from "@/ts/interfaces/traces/serviceDetection.types";
import { useSpanServiceDetection } from "./useSpanServiceDetection";

const makeSpan = (overrides: Record<string, unknown> = {}) =>
  ({
    span_id: "s1",
    trace_id: "t1",
    start_time: 0,
    end_time: 1000,
    duration: 1000,
    service_name: "my-service",
    operation_name: "op",
    _timestamp: 0,
    ...overrides,
  }) as any;

describe("resolveSpanIdentity", () => {
  const config = ref<ServiceDetectionConfig | null>(null);
  const { resolveSpanIdentity } = useSpanServiceDetection(config);

  afterEach(() => {
    config.value = null;
  });

  describe("infer_service_name priority", () => {
    it("should return infer_service_name when present", () => {
      const span = makeSpan({
        infer_service_name: "inferred-svc",
        infer_service_system: "inferred-sys",
        service_name: "my-service",
      });
      expect(resolveSpanIdentity(span)).toBe("inferred-svc");
    });

    it("should return infer_service_name even when it is the only field set", () => {
      const span = makeSpan({
        infer_service_name: "inferred-svc",
        service_name: "",
      });
      expect(resolveSpanIdentity(span)).toBe("inferred-svc");
    });
  });

  describe("infer_service_system fallback", () => {
    it("should return infer_service_system when infer_service_name is absent", () => {
      const span = makeSpan({
        infer_service_system: "inferred-sys",
        service_name: "my-service",
      });
      expect(resolveSpanIdentity(span)).toBe("inferred-sys");
    });

    it("should return infer_service_system when infer_service_name is empty string", () => {
      const span = makeSpan({
        infer_service_name: "",
        infer_service_system: "inferred-sys",
        service_name: "my-service",
      });
      expect(resolveSpanIdentity(span)).toBe("inferred-sys");
    });
  });

  describe("service_name fallback", () => {
    it("should return service_name when neither inferred field is present", () => {
      const span = makeSpan({ service_name: "my-service" });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });

    it("should return service_name when inferred fields are empty strings", () => {
      const span = makeSpan({
        infer_service_name: "",
        infer_service_system: "",
        service_name: "my-service",
      });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });
  });

  describe("empty fallback", () => {
    it("should return empty string when all name fields are missing", () => {
      const span = makeSpan({ service_name: "" });
      expect(resolveSpanIdentity(span)).toBe("");
    });

    it("should return empty string when all name fields are absent from span", () => {
      const span = makeSpan({});
      delete (span as any).service_name;
      expect(resolveSpanIdentity(span)).toBe("");
    });
  });

  describe("edge cases", () => {
    it("should not crash when span has no extra attributes", () => {
      const span = makeSpan({ span_kind: "CLIENT" });
      expect(() => resolveSpanIdentity(span)).not.toThrow();
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });

    it("should not use config for detection regardless of config value", () => {
      config.value = {
        server_kinds: ["SERVER"],
        rules: [{ attributes: ["db_system"], sub_attributes: ["db_name"] }],
      };
      // Even with config set, resolveSpanIdentity ignores it and uses span fields only
      const span = makeSpan({
        span_kind: "CLIENT",
        db_system: "postgresql",
        db_name: "orders",
        service_name: "my-service",
      });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });
  });
});
