// Copyright 2026 OpenObserve Inc.
import { describe, expect, it } from "vitest";
import { SpanKind } from "@/ts/interfaces/traces/span.types";
import { resolveSpanIdentity, getServiceName } from "./spanIdentity";

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

// ─── getServiceName ──────────────────────────────────────────────────────────

const makeRawSpan = (fields: Record<string, unknown> = {}) =>
  ({ service_name: "my-service", ...fields }) as any;

describe("getServiceName", () => {
  describe("FaaS", () => {
    it("should return provider/name when both faas fields present", () => {
      expect(
        getServiceName(
          makeRawSpan({ faas_invoked_provider: "aws", faas_invoked_name: "process-order" }),
        ),
      ).toBe("aws/process-order");
    });

    it("should return name only when provider is absent", () => {
      expect(
        getServiceName(makeRawSpan({ faas_invoked_name: "handle-event" })),
      ).toBe("handle-event");
    });

    it("should return faas_trigger when faas_invoked_name is absent", () => {
      expect(getServiceName(makeRawSpan({ faas_trigger: "http" }))).toBe(
        "http",
      );
    });
  });

  describe("GraphQL", () => {
    it("should return type + name", () => {
      expect(
        getServiceName(
          makeRawSpan({
            graphql_operation_type: "query",
            graphql_operation_name: "GetUser",
          }),
        ),
      ).toBe("query GetUser");
    });

    it("should return type only when name is absent", () => {
      expect(
        getServiceName(makeRawSpan({ graphql_operation_type: "mutation" })),
      ).toBe("mutation");
    });
  });

  describe("Cloud Storage", () => {
    it("should return known AWS service label", () => {
      expect(
        getServiceName(
          makeRawSpan({ rpc_system: "aws-api", rpc_service: "S3" }),
        ),
      ).toBe("AWS S3");
    });

    it("should append rpc_method to AWS label", () => {
      expect(
        getServiceName(
          makeRawSpan({
            rpc_system: "aws-api",
            rpc_service: "S3",
            rpc_method: "GetObject",
          }),
        ),
      ).toBe("AWS S3: GetObject");
    });

    it("should fallback to 'AWS <service>' for unknown AWS service", () => {
      expect(
        getServiceName(
          makeRawSpan({ rpc_system: "aws-api", rpc_service: "Bedrock" }),
        ),
      ).toBe("AWS Bedrock");
    });

    it("should return Google Cloud Storage for googleapis.com domain", () => {
      expect(
        getServiceName(
          makeRawSpan({ server_address: "storage.googleapis.com" }),
        ),
      ).toBe("Google Cloud Storage");
    });

    it("should return Azure Blob Storage for blob.core.windows.net domain", () => {
      expect(
        getServiceName(
          makeRawSpan({
            server_address: "myaccount.blob.core.windows.net",
          }),
        ),
      ).toBe("Azure Blob Storage");
    });

    it("should return AWS <subdomain> for amazonaws.com domain", () => {
      expect(
        getServiceName(
          makeRawSpan({ server_address: "s3.amazonaws.com" }),
        ),
      ).toBe("AWS s3");
    });
  });

  describe("Cache (db_system in CACHE_SYSTEMS)", () => {
    it("should return 'redis: GET' when operation present", () => {
      expect(
        getServiceName(
          makeRawSpan({ db_system: "redis", db_operation_name: "GET" }),
        ),
      ).toBe("redis: GET");
    });

    it("should return 'memcached' when no operation present", () => {
      expect(
        getServiceName(makeRawSpan({ db_system: "memcached" })),
      ).toBe("memcached");
    });
  });

  describe("Database", () => {
    it("should return 'op collection' when both present", () => {
      expect(
        getServiceName(
          makeRawSpan({
            db_system: "postgresql",
            db_operation_name: "SELECT",
            db_collection_name: "users",
          }),
        ),
      ).toBe("SELECT users");
    });

    it("should return op only when collection absent", () => {
      expect(
        getServiceName(
          makeRawSpan({ db_system: "postgresql", db_operation_name: "SELECT" }),
        ),
      ).toBe("SELECT");
    });

    it("should return db_query_summary when op absent", () => {
      expect(
        getServiceName(
          makeRawSpan({
            db_system: "postgresql",
            db_query_summary: "SELECT from orders",
          }),
        ),
      ).toBe("SELECT from orders");
    });

    it("should truncate db_statement longer than 80 chars", () => {
      const long = "SELECT * FROM users WHERE id = 1 AND status = 'active' AND created_at > now()";
      expect(
        getServiceName(makeRawSpan({ db_system: "postgresql", db_statement: long })),
      ).toBe(`${long.slice(0, 80)}…`);
    });

    it("should return 'system: name' when only db_name present", () => {
      expect(
        getServiceName(
          makeRawSpan({ db_system: "postgresql", db_name: "orders" }),
        ),
      ).toBe("postgresql: orders");
    });

    it("should return db_system alone as final fallback", () => {
      expect(
        getServiceName(makeRawSpan({ db_system: "mysql" })),
      ).toBe("mysql");
    });
  });

  describe("Messaging", () => {
    it("should return 'op → dest' when all present", () => {
      expect(
        getServiceName(
          makeRawSpan({
            messaging_system: "kafka",
            messaging_destination_name: "order-events",
            messaging_operation: "publish",
          }),
        ),
      ).toBe("publish → order-events");
    });

    it("should return destination only when op absent", () => {
      expect(
        getServiceName(
          makeRawSpan({ messaging_destination_name: "order-events" }),
        ),
      ).toBe("order-events");
    });

    it("should return messaging_system alone as fallback", () => {
      expect(
        getServiceName(makeRawSpan({ messaging_system: "rabbitmq" })),
      ).toBe("rabbitmq");
    });
  });

  describe("RPC", () => {
    it("should return 'service/method' when both present", () => {
      expect(
        getServiceName(
          makeRawSpan({
            rpc_system: "grpc",
            rpc_service: "UserService",
            rpc_method: "GetUser",
          }),
        ),
      ).toBe("UserService/GetUser");
    });

    it("should return rpc_service alone when method absent", () => {
      expect(
        getServiceName(
          makeRawSpan({ rpc_system: "grpc", rpc_service: "UserService" }),
        ),
      ).toBe("UserService");
    });

    it("should return rpc_system alone as final fallback", () => {
      expect(
        getServiceName(makeRawSpan({ rpc_system: "thrift" })),
      ).toBe("thrift");
    });
  });

  describe("HTTP Client", () => {
    it("should prefer http_route template over url_path", () => {
      expect(
        getServiceName(
          makeRawSpan({
            http_request_method: "GET",
            http_route: "/users/:id",
            url_path: "/users/123",
          }),
        ),
      ).toBe("GET /users/:id");
    });

    it("should use url_path when http_route absent", () => {
      expect(
        getServiceName(
          makeRawSpan({ http_request_method: "GET", url_path: "/users/123" }),
        ),
      ).toBe("GET /users/123");
    });

    it("should use server_address when path absent", () => {
      expect(
        getServiceName(
          makeRawSpan({
            http_request_method: "POST",
            server_address: "api.example.com",
          }),
        ),
      ).toBe("POST api.example.com");
    });

    it("should return url_path alone when method absent", () => {
      expect(
        getServiceName(makeRawSpan({ url_path: "/api/users" })),
      ).toBe("/api/users");
    });

    it("should return server_address alone as final HTTP fallback", () => {
      expect(
        getServiceName(makeRawSpan({ server_address: "api.example.com" })),
      ).toBe("api.example.com");
    });
  });

  describe("Fallback", () => {
    it("should return service_name when no identity attributes present", () => {
      expect(getServiceName(makeRawSpan())).toBe("my-service");
    });

    it("should return 'unknown' when service_name is empty", () => {
      expect(getServiceName(makeRawSpan({ service_name: "" }))).toBe("unknown");
    });
  });
});
