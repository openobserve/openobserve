// Copyright 2026 OpenObserve Inc.
import { ref } from "vue";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { ServiceDetectionConfig } from "@/ts/interfaces/traces/serviceDetection.types";
import { useSpanServiceDetection } from "./useSpanServiceDetection";

const DEFAULT_CONFIG: ServiceDetectionConfig = {
  server_kinds: ["SERVER", "INTERNAL", "UNSPECIFIED"],
  rules: [
    { attributes: ["db_system", "db.system"], sub_attributes: ["db_name", "db.name"] },
    {
      attributes: ["messaging_system", "messaging.system"],
      sub_attributes: ["messaging_destination_name", "messaging.destination.name"],
    },
    { attributes: ["rpc_system", "rpc.system"], sub_attributes: ["rpc_service", "rpc.service"] },
    {
      attributes: ["server_address", "net.peer.name"],
      sub_attributes: ["url_path", "http.target"],
    },
  ],
};

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

  describe("no config loaded", () => {
    it("should return service_name regardless of attributes", () => {
      const span = makeSpan({ span_kind: "CLIENT", db_system: "postgresql" });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });

    it("should return 'unknown' when service_name is empty", () => {
      const span = makeSpan({ span_kind: "CLIENT", service_name: "" });
      expect(resolveSpanIdentity(span)).toBe("unknown");
    });
  });

  describe("server_kinds gate — inbound/internal spans always use service_name", () => {
    beforeEach(() => {
      config.value = DEFAULT_CONFIG;
    });

    it("should return service_name for SERVER span even with db attributes", () => {
      const span = makeSpan({ span_kind: "SERVER", db_system: "postgresql", db_name: "orders" });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });

    it("should return service_name for INTERNAL span", () => {
      const span = makeSpan({ span_kind: "INTERNAL", messaging_system: "kafka" });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });

    it("should return service_name for UNSPECIFIED span", () => {
      const span = makeSpan({ span_kind: "UNSPECIFIED", server_address: "api.example.com" });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });

    it("should return service_name when span_kind is absent", () => {
      const span = makeSpan({ db_system: "postgresql" });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });
  });

  describe("detection rules — CLIENT/PRODUCER/CONSUMER spans", () => {
    beforeEach(() => {
      config.value = DEFAULT_CONFIG;
    });

    describe("db rule", () => {
      it("should return db_name when db_system and db_name are present", () => {
        const span = makeSpan({ span_kind: "CLIENT", db_system: "postgresql", db_name: "orders" });
        expect(resolveSpanIdentity(span)).toBe("orders");
      });

      it("should return db_system alone when db_name is absent", () => {
        const span = makeSpan({ span_kind: "CLIENT", db_system: "redis" });
        expect(resolveSpanIdentity(span)).toBe("redis");
      });

      it("should match db.system (dot-notation) as attribute fallback", () => {
        const span = makeSpan({ span_kind: "CLIENT", "db.system": "mysql", "db.name": "catalog" });
        expect(resolveSpanIdentity(span)).toBe("catalog");
      });

      it("should prefer db_system (underscore) over db.system (dot) in attributes array", () => {
        const span = makeSpan({
          span_kind: "CLIENT",
          db_system: "postgresql",
          "db.system": "mysql",
          db_name: "orders",
        });
        expect(resolveSpanIdentity(span)).toBe("orders");
      });
    });

    describe("messaging rule", () => {
      it("should return destination name when both messaging attributes present", () => {
        const span = makeSpan({
          span_kind: "PRODUCER",
          messaging_system: "kafka",
          messaging_destination_name: "order-events",
        });
        expect(resolveSpanIdentity(span)).toBe("order-events");
      });

      it("should return messaging_system alone when destination is absent", () => {
        const span = makeSpan({ span_kind: "CONSUMER", messaging_system: "rabbitmq" });
        expect(resolveSpanIdentity(span)).toBe("rabbitmq");
      });

      it("should match messaging.system (dot-notation)", () => {
        const span = makeSpan({
          span_kind: "CONSUMER",
          "messaging.system": "sqs",
          "messaging.destination.name": "my-queue",
        });
        expect(resolveSpanIdentity(span)).toBe("my-queue");
      });
    });

    describe("rpc rule", () => {
      it("should return rpc_service when both rpc attributes present", () => {
        const span = makeSpan({ span_kind: "CLIENT", rpc_system: "grpc", rpc_service: "UserService" });
        expect(resolveSpanIdentity(span)).toBe("UserService");
      });

      it("should return rpc_system alone when rpc_service is absent", () => {
        const span = makeSpan({ span_kind: "CLIENT", rpc_system: "thrift" });
        expect(resolveSpanIdentity(span)).toBe("thrift");
      });
    });

    describe("server_address rule", () => {
      it("should return url_path when both server_address and url_path present", () => {
        const span = makeSpan({
          span_kind: "CLIENT",
          server_address: "api.example.com",
          url_path: "/v1/users",
        });
        expect(resolveSpanIdentity(span)).toBe("/v1/users");
      });

      it("should return server_address alone when url_path is absent", () => {
        const span = makeSpan({ span_kind: "CLIENT", server_address: "api.example.com" });
        expect(resolveSpanIdentity(span)).toBe("api.example.com");
      });
    });

    describe("priority waterfall — first matching rule wins", () => {
      it("should prefer db rule over messaging rule", () => {
        const span = makeSpan({
          span_kind: "CLIENT",
          db_system: "postgresql",
          messaging_system: "kafka",
        });
        expect(resolveSpanIdentity(span)).toBe("postgresql");
      });

      it("should prefer db rule over server_address rule", () => {
        const span = makeSpan({
          span_kind: "CLIENT",
          db_system: "postgresql",
          db_name: "orders",
          server_address: "pg.internal",
        });
        expect(resolveSpanIdentity(span)).toBe("orders");
      });
    });

    describe("fallback to service_name", () => {
      it("should return service_name when no rule attributes match", () => {
        const span = makeSpan({ span_kind: "CLIENT" });
        expect(resolveSpanIdentity(span)).toBe("my-service");
      });

      it("should return 'unknown' when service_name is empty and no rule matches", () => {
        const span = makeSpan({ span_kind: "CLIENT", service_name: "" });
        expect(resolveSpanIdentity(span)).toBe("unknown");
      });
    });
  });

  describe("custom config rules", () => {
    it("should use custom detection rules from config", () => {
      config.value = {
        server_kinds: ["SERVER"],
        rules: [{ attributes: ["cache_system"], sub_attributes: ["cache_key_prefix"] }],
      };
      const span = makeSpan({ span_kind: "CLIENT", cache_system: "redis", cache_key_prefix: "user:" });
      expect(resolveSpanIdentity(span)).toBe("user:");
    });

    it("should respect custom server_kinds list", () => {
      config.value = {
        server_kinds: ["CLIENT"],
        rules: [{ attributes: ["db_system"] }],
      };
      const span = makeSpan({ span_kind: "CLIENT", db_system: "postgresql" });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });
  });

  describe("edge cases", () => {
    beforeEach(() => {
      config.value = DEFAULT_CONFIG;
    });

    it("should not crash when span has no extra attributes", () => {
      const span = makeSpan({ span_kind: "CLIENT" });
      expect(() => resolveSpanIdentity(span)).not.toThrow();
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });

    it("should handle numeric span_kind ('3' = Client in SPAN_KIND_MAP)", () => {
      const span = makeSpan({ span_kind: "3", db_system: "postgresql" });
      expect(resolveSpanIdentity(span)).toBe("postgresql");
    });
  });
});
