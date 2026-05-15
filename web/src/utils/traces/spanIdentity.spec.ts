// Copyright 2026 OpenObserve Inc.
import { describe, expect, it } from "vitest";
import { SpanKind } from "@/ts/interfaces/traces/span.types";
import { resolveSpanIdentity } from "./spanIdentity";

const makeSpan = (overrides: Record<string, unknown> = {}) =>
  ({
    span_id: "s1",
    trace_id: "t1",
    parent_span_id: "",
    start_time: 0,
    end_time: 1000,
    duration: 1000,
    service_name: "my-service",
    operation_name: "op",
    _timestamp: 0,
    attributes: {},
    ...overrides,
  }) as any;

describe("resolveSpanIdentity", () => {
  describe("SpanKind gate — inbound/internal spans always use service_name", () => {
    it("should return service_name when kind is SERVER regardless of attributes", () => {
      const span = makeSpan({
        span_kind: SpanKind.SERVER,
        attributes: { "db.system": "postgresql", "peer.service": "other" },
      });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });

    it("should return service_name when kind is INTERNAL", () => {
      const span = makeSpan({
        span_kind: SpanKind.INTERNAL,
        attributes: { "db.system": "redis" },
      });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });

    it("should return service_name when kind is UNSPECIFIED", () => {
      const span = makeSpan({
        span_kind: SpanKind.UNSPECIFIED,
        attributes: { "server.address": "api.stripe.com" },
      });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });

    it("should return service_name when span_kind is absent", () => {
      const span = makeSpan({ attributes: { "db.system": "postgresql" } });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });

    it("should run the waterfall for PRODUCER spans", () => {
      const span = makeSpan({
        span_kind: SpanKind.PRODUCER,
        attributes: {
          "messaging.system": "kafka",
          "messaging.destination.name": "order-events",
        },
      });
      expect(resolveSpanIdentity(span)).toBe("kafka:order-events");
    });

    it("should run the waterfall for CONSUMER spans", () => {
      const span = makeSpan({
        span_kind: SpanKind.CONSUMER,
        attributes: { "messaging.destination.name": "order-events" },
      });
      expect(resolveSpanIdentity(span)).toBe("order-events");
    });
  });

  describe("Priority 1: peer.service wins over everything", () => {
    it("should return peer.service on a CLIENT span", () => {
      const span = makeSpan({
        span_kind: SpanKind.CLIENT,
        attributes: {
          "peer.service": "stripe-api",
          "db.system": "postgresql",
          "server.address": "pg.internal",
        },
      });
      expect(resolveSpanIdentity(span)).toBe("stripe-api");
    });
  });

  describe("Priority 2: db.system + db.name", () => {
    it("should return 'system:name' when both db.system and db.name are present", () => {
      const span = makeSpan({
        span_kind: SpanKind.CLIENT,
        attributes: { "db.system": "postgresql", "db.name": "orders" },
      });
      expect(resolveSpanIdentity(span)).toBe("postgresql:orders");
    });
  });

  describe("Priority 3: db.system alone", () => {
    it("should return db.system when db.name is absent", () => {
      const span = makeSpan({
        span_kind: SpanKind.CLIENT,
        attributes: { "db.system": "redis" },
      });
      expect(resolveSpanIdentity(span)).toBe("redis");
    });
  });

  describe("Priority 4: messaging.system + messaging.destination.name", () => {
    it("should return 'system:destination' when both messaging attributes are present", () => {
      const span = makeSpan({
        span_kind: SpanKind.PRODUCER,
        attributes: {
          "messaging.system": "kafka",
          "messaging.destination.name": "user-events",
        },
      });
      expect(resolveSpanIdentity(span)).toBe("kafka:user-events");
    });
  });

  describe("Priority 5: messaging.destination.name alone", () => {
    it("should return messaging.destination.name when messaging.system is absent", () => {
      const span = makeSpan({
        span_kind: SpanKind.CONSUMER,
        attributes: { "messaging.destination.name": "order-events" },
      });
      expect(resolveSpanIdentity(span)).toBe("order-events");
    });
  });

  describe("Priority 6: rpc.system + rpc.service", () => {
    it("should return 'rpc.system:rpc.service' when both are present", () => {
      const span = makeSpan({
        span_kind: SpanKind.CLIENT,
        attributes: { "rpc.system": "grpc", "rpc.service": "UserService" },
      });
      expect(resolveSpanIdentity(span)).toBe("grpc:UserService");
    });
  });

  describe("Priority 7: rpc.system alone", () => {
    it("should return rpc.system when rpc.service is absent", () => {
      const span = makeSpan({
        span_kind: SpanKind.CLIENT,
        attributes: { "rpc.system": "thrift" },
      });
      expect(resolveSpanIdentity(span)).toBe("thrift");
    });
  });

  describe("Priority 8: server.address + url.path", () => {
    it("should return concatenated host+path when both are present", () => {
      const span = makeSpan({
        span_kind: SpanKind.CLIENT,
        attributes: {
          "server.address": "api.stripe.com",
          "url.path": "/v1/charges",
        },
      });
      expect(resolveSpanIdentity(span)).toBe("api.stripe.com/v1/charges");
    });
  });

  describe("Priority 9: server.address alone", () => {
    it("should return server.address when url.path is absent", () => {
      const span = makeSpan({
        span_kind: SpanKind.CLIENT,
        attributes: { "server.address": "api.stripe.com" },
      });
      expect(resolveSpanIdentity(span)).toBe("api.stripe.com");
    });
  });

  describe("Priority 10: fallback to service_name", () => {
    it("should return service_name when CLIENT span has no identity attributes", () => {
      const span = makeSpan({ span_kind: SpanKind.CLIENT });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });

    it("should return 'unknown' when service_name is empty and no identity attrs", () => {
      const span = makeSpan({ span_kind: SpanKind.CLIENT, service_name: "" });
      expect(resolveSpanIdentity(span)).toBe("unknown");
    });
  });

  describe("competing attributes — higher priority wins", () => {
    it("should prefer db.system over rpc.system when both are present", () => {
      const span = makeSpan({
        span_kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "rpc.system": "grpc",
          "rpc.service": "OrderService",
        },
      });
      expect(resolveSpanIdentity(span)).toBe("postgresql");
    });

    it("should prefer db.system+db.name over server.address when both are present", () => {
      const span = makeSpan({
        span_kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.name": "orders",
          "server.address": "pg.internal",
        },
      });
      expect(resolveSpanIdentity(span)).toBe("postgresql:orders");
    });
  });

  describe("edge cases", () => {
    it("should not crash when attributes is undefined", () => {
      const span = makeSpan({
        span_kind: SpanKind.CLIENT,
        attributes: undefined,
      });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });

    it("should not crash when attributes is null", () => {
      const span = makeSpan({ span_kind: SpanKind.CLIENT, attributes: null });
      expect(resolveSpanIdentity(span)).toBe("my-service");
    });
  });
});
