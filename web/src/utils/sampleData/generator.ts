// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import {
  COUNTRIES,
  PAYMENT_METHODS,
  PRODUCTS,
  SAMPLE_METRICS,
  SAMPLE_NAMESPACE,
  SAMPLE_ROUTES,
  SAMPLE_SERVICES,
  STATIC_ASSETS,
  USER_AGENTS,
  nodeForPod,
  serviceByName,
  type SampleRouteId,
  type SampleServiceName,
} from "./catalog";

type Row = Record<string, string | number | boolean>;

export interface SampleWindow {
  startUs: number;
  endUs: number;
}

/** One time slice of generated data, ingested as one round of requests. */
export interface SampleBatch {
  appLogs: Row[];
  accessLogs: Row[];
  traces: { resourceSpans: OtlpResourceSpans[] };
  spanCount: number;
  metrics: Row[];
}

interface OtlpAttribute {
  key: string;
  value:
    | { stringValue: string }
    | { intValue: number }
    | { doubleValue: number }
    | { boolValue: boolean };
}

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  status: { code: number; message?: string };
  events?: { timeUnixNano: string; name: string; attributes: OtlpAttribute[] }[];
}

interface OtlpResourceSpans {
  resource: { attributes: OtlpAttribute[] };
  scopeSpans: { scope: { name: string; version: string }; spans: OtlpSpan[] }[];
}

const MINUTE_US = 60_000_000;
const CHUNK_US = 15 * MINUTE_US;
// two samples inside a 1m window, so rate(x[1m]) works the way it does on a real 30s scrape
const SCRAPE_US = 30_000_000;
const BASE_RPS = 1.1;
const KIND = { internal: 1, server: 2, client: 3, producer: 4, consumer: 5 } as const;
const STATUS = { unset: 0, ok: 1, error: 2 } as const;

interface SpanDraft {
  service: SampleServiceName;
  pod: string;
  name: string;
  kind: number;
  startUs: number;
  durationUs: number;
  spanId: string;
  parentSpanId?: string;
  attrs: Row;
  error?: { type: string; message: string };
}

interface RequestResult {
  traceId: string;
  status: number;
  durationUs: number;
  spans: SpanDraft[];
  logs: Row[];
}

interface SlotStats {
  requests: Map<string, number>;
  latencies: Map<SampleServiceName, number[]>;
  orders: Map<string, number>;
}

const hex = (len: number) => {
  let out = "";
  for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
};

const pickWeighted = <T extends { weight: number }>(items: readonly T[]): T => {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
};

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

const gaussian = () => {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Log-normal milliseconds around a median, so latency has a realistic long tail. */
const latencyMs = (medianMs: number, spread = 0.45) => medianMs * Math.exp(gaussian() * spread);

const poisson = (lambda: number) => {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > limit);
  return k - 1;
};

const attr = (key: string, value: string | number | boolean): OtlpAttribute => {
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { key, value: { intValue: value } }
      : { key, value: { doubleValue: value } };
  }
  return { key, value: { stringValue: value } };
};

const ipFor = (seed: number) =>
  `${[73, 81, 92, 103, 145, 176, 185, 203][seed % 8]}.${(seed * 7) % 255}.${(seed * 13) % 255}.${((seed * 29) % 254) + 1}`;

/** Builds a request's span tree; children are laid out sequentially inside their parent. */
class TraceBuilder {
  readonly traceId = hex(32);
  readonly spans: SpanDraft[] = [];

  span(
    service: SampleServiceName,
    name: string,
    kind: number,
    startUs: number,
    parent: SpanDraft | undefined,
    attrs: Row = {},
  ): SpanDraft {
    const draft: SpanDraft = {
      service,
      pod: pick(serviceByName(service).pods),
      name,
      kind,
      startUs,
      durationUs: 0,
      spanId: hex(16),
      parentSpanId: parent?.spanId,
      attrs,
    };
    this.spans.push(draft);
    return draft;
  }

  /** A leaf call of `ms` milliseconds; returns its end time. */
  leaf(
    service: SampleServiceName,
    name: string,
    kind: number,
    startUs: number,
    parent: SpanDraft,
    ms: number,
    attrs: Row = {},
  ): SpanDraft {
    const s = this.span(service, name, kind, startUs, parent, attrs);
    s.durationUs = Math.max(50, Math.round(ms * 1000));
    return s;
  }
}

const endOf = (s: SpanDraft) => s.startUs + s.durationUs;

const close = (s: SpanDraft, untilUs: number, padMs = 0.4) => {
  s.durationUs = Math.max(80, untilUs - s.startUs + Math.round(latencyMs(padMs, 0.3) * 1000));
};

export function createSampleGenerator(window: SampleWindow) {
  const startUs = Math.floor(window.startUs / MINUTE_US) * MINUTE_US;
  const endUs = window.endUs;
  const incident = {
    paymentFromUs: endUs - 35 * MINUTE_US,
    recoFromUs: endUs - 140 * MINUTE_US,
    recoToUs: endUs - 124 * MINUTE_US,
  };
  const chunkCount = Math.max(1, Math.ceil((endUs - startUs) / CHUNK_US));
  const counters = new Map<string, number>();
  const userCount = 4200;

  const inPaymentIncident = (ts: number) => ts >= incident.paymentFromUs;
  const inRecoIncident = (ts: number) => ts >= incident.recoFromUs && ts < incident.recoToUs;
  const versionOf = (service: SampleServiceName, ts: number) =>
    service === "payment" && inPaymentIncident(ts) ? "2.15.0" : serviceByName(service).version;

  const baseLog = (
    service: SampleServiceName,
    pod: string,
    ts: number,
    level: string,
    message: string,
  ): Row => ({
    _timestamp: ts,
    level,
    service_name: service,
    service_version: versionOf(service, ts),
    k8s_namespace_name: SAMPLE_NAMESPACE,
    k8s_pod_name: pod,
    k8s_container_name: service,
    k8s_node_name: nodeForPod(pod),
    message,
  });

  const spanLog = (
    s: SpanDraft,
    traceId: string,
    level: string,
    message: string,
    extra: Row = {},
  ): Row => ({
    ...baseLog(s.service, s.pod, endOf(s), level, message),
    trace_id: traceId,
    span_id: s.spanId,
    ...extra,
  });

  const dbQuery = (
    tb: TraceBuilder,
    service: SampleServiceName,
    parent: SpanDraft,
    at: number,
    table: string,
    ms: number,
  ) =>
    tb.leaf(service, `SELECT ${table}`, KIND.client, at, parent, ms, {
      "db.system": "postgresql",
      "db.name": "storefront",
      "db.statement": `SELECT * FROM ${table} WHERE id = $1`,
      "net.peer.name": "postgres.storefront.svc",
    });

  const cacheGet = (
    tb: TraceBuilder,
    service: SampleServiceName,
    parent: SpanDraft,
    at: number,
    key: string,
  ) =>
    tb.leaf(service, "redis GET", KIND.client, at, parent, latencyMs(0.6, 0.3), {
      "db.system": "redis",
      "db.operation": "GET",
      "db.redis.key": key,
    });

  const serverSpan = (
    tb: TraceBuilder,
    service: SampleServiceName,
    method: string,
    route: string,
    at: number,
    parent?: SpanDraft,
  ) =>
    tb.span(service, `${method} ${route}`, KIND.server, at, parent, {
      "http.method": method,
      "http.route": route,
    });

  const catalog = (
    tb: TraceBuilder,
    parent: SpanDraft,
    at: number,
    route: string,
    productId?: string,
  ) => {
    const s = serverSpan(tb, "product-catalog", "GET", route, at, parent);
    const cache = cacheGet(
      tb,
      "product-catalog",
      s,
      at + 150,
      productId ? `product:${productId}` : "products:page:1",
    );
    let cursor = endOf(cache);
    if (Math.random() < 0.3)
      cursor = endOf(dbQuery(tb, "product-catalog", s, cursor + 100, "products", latencyMs(9)));
    close(s, cursor);
    return s;
  };

  const recommendation = (tb: TraceBuilder, parent: SpanDraft, at: number, logs: Row[]) => {
    const s = serverSpan(tb, "recommendation", "GET", "/recommendations", at, parent);
    const slow = inRecoIncident(at);
    const model = tb.leaf(
      "recommendation",
      "model.predict",
      KIND.internal,
      at + 200,
      s,
      latencyMs(slow ? 900 : 28, slow ? 0.6 : 0.4),
      {
        "model.name": "item2vec-v7",
        "model.candidates": 120,
      },
    );
    close(s, endOf(model));
    const timedOut = slow && s.durationUs > 1_200_000;
    if (timedOut) {
      s.error = { type: "TimeoutError", message: "recommendation model exceeded 1200ms budget" };
      s.attrs["http.status_code"] = 504;
      logs.push(
        spanLog(
          s,
          tb.traceId,
          "warn",
          "Model inference exceeded latency budget (1200ms), returning fallback list",
          { duration_ms: Math.round(s.durationUs / 1000), http_route: "/recommendations" },
        ),
      );
    } else {
      s.attrs["http.status_code"] = 200;
      if (Math.random() < 0.15)
        logs.push(
          spanLog(s, tb.traceId, "info", "Served 5 recommendations", {
            duration_ms: Math.round(s.durationUs / 1000),
            model_name: "item2vec-v7",
          }),
        );
    }
    return s;
  };

  const cart = (
    tb: TraceBuilder,
    parent: SpanDraft,
    at: number,
    method: "GET" | "POST",
    userId: string,
  ) => {
    const s = serverSpan(tb, "cart", method, "/cart", at, parent);
    const op = method === "GET" ? "HGETALL" : "HSET";
    const r = tb.leaf("cart", `redis ${op}`, KIND.client, at + 120, s, latencyMs(0.9, 0.3), {
      "db.system": "redis",
      "db.operation": op,
      "db.redis.key": `cart:${userId}`,
    });
    close(s, endOf(r));
    s.attrs["http.status_code"] = 200;
    return s;
  };

  const payment = (
    tb: TraceBuilder,
    parent: SpanDraft,
    at: number,
    amount: number,
    method: string,
    orderId: string,
    logs: Row[],
  ) => {
    const s = serverSpan(tb, "payment", "POST", "/charge", at, parent);
    const incidentNow = inPaymentIncident(at);
    const poolTimeout = incidentNow && Math.random() < 0.38;
    const acquire = tb.leaf(
      "payment",
      "pg.pool.acquire",
      KIND.internal,
      at + 100,
      s,
      poolTimeout ? 3000 + latencyMs(40) : latencyMs(incidentNow ? 260 : 1.2, 0.5),
      {
        "db.system": "postgresql",
        "pool.max": 20,
        "pool.in_use": incidentNow ? 20 : 6 + Math.floor(Math.random() * 5),
      },
    );
    if (poolTimeout) {
      acquire.error = {
        type: "PoolTimeoutError",
        message: "timeout acquiring connection from pool after 3000ms (20/20 in use)",
      };
      close(s, endOf(acquire));
      s.error = {
        type: "PaymentProcessingError",
        message: "could not persist payment intent: connection pool exhausted",
      };
      s.attrs["http.status_code"] = 503;
      logs.push(
        spanLog(
          s,
          tb.traceId,
          "error",
          "Payment failed: could not persist payment intent: timeout acquiring connection from pool after 3000ms",
          {
            error_type: "PoolTimeoutError",
            order_id: orderId,
            amount,
            currency: "USD",
            payment_method: method,
            duration_ms: Math.round(s.durationUs / 1000),
            db_pool_in_use: 20,
            db_pool_max: 20,
            stacktrace:
              "PoolTimeoutError: timeout acquiring connection from pool after 3000ms\n    at Pool.acquire (node_modules/pg-pool/index.js:298:17)\n    at PaymentRepository.saveIntent (src/repositories/payment.ts:58:21)\n    at ChargeHandler.handle (src/handlers/charge.ts:41:9)",
          },
        ),
      );
      return s;
    }
    const gateway = tb.leaf(
      "payment",
      "POST api.stripe.com/v1/charges",
      KIND.client,
      endOf(acquire) + 80,
      s,
      latencyMs(180, 0.35),
      {
        "http.method": "POST",
        "net.peer.name": "api.stripe.com",
        "http.status_code": 200,
        "payment.method": method,
      },
    );
    const insert = tb.leaf(
      "payment",
      "INSERT payments",
      KIND.client,
      endOf(gateway) + 60,
      s,
      latencyMs(incidentNow ? 40 : 4),
      {
        "db.system": "postgresql",
        "db.statement": "INSERT INTO payments (order_id, amount, status) VALUES ($1, $2, $3)",
      },
    );
    close(s, endOf(insert));
    s.attrs["http.status_code"] = 200;
    logs.push(
      spanLog(s, tb.traceId, "info", `Payment authorized for order ${orderId}`, {
        order_id: orderId,
        amount,
        currency: "USD",
        payment_method: method,
        duration_ms: Math.round(s.durationUs / 1000),
      }),
    );
    return s;
  };

  const flows: Record<
    Exclude<SampleRouteId, "staticAsset">,
    (
      tb: TraceBuilder,
      root: SpanDraft,
      at: number,
      ctx: { userId: string; country: string; logs: Row[] },
    ) => number
  > = {
    home: (tb, root, at, ctx) => {
      const p = catalog(tb, root, at + 300, "/products");
      const r = recommendation(tb, root, endOf(p) + 200, ctx.logs);
      if (r.error) {
        ctx.logs.push(
          spanLog(
            root,
            tb.traceId,
            "warn",
            "Recommendations unavailable, rendering home page without them",
            { http_route: "/" },
          ),
        );
      }
      return endOf(r);
    },
    listProducts: (tb, root, at) => endOf(catalog(tb, root, at + 250, "/products")),
    getProduct: (tb, root, at) => {
      const product = pick(PRODUCTS);
      const p = catalog(tb, root, at + 250, "/products/{id}", product.id);
      root.attrs["product.id"] = product.id;
      if (Math.random() < 0.025) {
        p.attrs["http.status_code"] = 404;
        root.attrs["http.status_code"] = 404;
      }
      return endOf(p);
    },
    recommendations: (tb, root, at, ctx) => {
      const r = recommendation(tb, root, at + 250, ctx.logs);
      if (r.error) root.attrs["http.status_code"] = 504;
      return endOf(r);
    },
    addToCart: (tb, root, at, ctx) => endOf(cart(tb, root, at + 250, "POST", ctx.userId)),
    getCart: (tb, root, at, ctx) => endOf(cart(tb, root, at + 250, "GET", ctx.userId)),
    login: (tb, root, at, ctx) => {
      const s = serverSpan(tb, "auth", "POST", "/login", at + 250, root);
      const q = dbQuery(tb, "auth", s, at + 400, "users", latencyMs(6));
      const hash = tb.leaf(
        "auth",
        "bcrypt.compare",
        KIND.internal,
        endOf(q) + 50,
        s,
        latencyMs(55, 0.15),
      );
      close(s, endOf(hash));
      const failed = Math.random() < 0.09;
      s.attrs["http.status_code"] = failed ? 401 : 200;
      root.attrs["http.status_code"] = failed ? 401 : 200;
      ctx.logs.push(
        spanLog(
          s,
          tb.traceId,
          failed ? "warn" : "info",
          failed ? "Login failed: invalid credentials" : "User login succeeded",
          {
            user_id: ctx.userId,
            auth_method: "password",
            client_country: ctx.country,
          },
        ),
      );
      return endOf(s);
    },
    checkout: (tb, root, at, ctx) => {
      const orderId = `ord_${hex(10)}`;
      const s = serverSpan(tb, "checkout", "POST", "/checkout", at + 250, root);
      const c = cart(tb, s, at + 450, "GET", ctx.userId);
      const items = 1 + Math.floor(Math.random() * 4);
      const lines = Array.from({ length: items }, () => pick(PRODUCTS));
      const amount = Math.round(lines.reduce((sum, p) => sum + p.price, 0) * 100) / 100;
      const inv = serverSpan(tb, "inventory", "POST", "/reserve", endOf(c) + 150, s);
      close(inv, endOf(dbQuery(tb, "inventory", inv, endOf(c) + 300, "stock", latencyMs(7))));
      inv.attrs["http.status_code"] = 200;
      const ship = serverSpan(tb, "shipping", "POST", "/quote", endOf(inv) + 120, s);
      close(
        ship,
        endOf(
          tb.leaf(
            "shipping",
            "rate.calculate",
            KIND.internal,
            endOf(inv) + 220,
            ship,
            latencyMs(3),
          ),
        ),
      );
      ship.attrs["http.status_code"] = 200;
      const method = pickWeighted(PAYMENT_METHODS).method;
      const pay = payment(tb, s, endOf(ship) + 150, amount, method, orderId, ctx.logs);
      let cursor = endOf(pay);
      if (!pay.error) {
        const publish = tb.leaf(
          "checkout",
          "orders publish",
          KIND.producer,
          cursor + 100,
          s,
          latencyMs(2),
          {
            "messaging.system": "kafka",
            "messaging.destination": "orders",
          },
        );
        cursor = endOf(publish);
      }
      close(s, cursor);
      if (pay.error) {
        s.error = { type: "UpstreamError", message: "payment service returned 503" };
        s.attrs["http.status_code"] = 502;
        root.attrs["http.status_code"] = 502;
        ctx.logs.push(
          spanLog(
            s,
            tb.traceId,
            "error",
            `Checkout failed for order ${orderId}: payment service returned 503`,
            {
              order_id: orderId,
              amount,
              currency: "USD",
              payment_method: method,
              error_type: "UpstreamError",
              user_id: ctx.userId,
            },
          ),
        );
      } else {
        s.attrs["http.status_code"] = 200;
        ctx.logs.push(
          spanLog(s, tb.traceId, "info", `Order ${orderId} placed`, {
            event: "order_placed",
            order_id: orderId,
            amount,
            currency: "USD",
            items_count: items,
            payment_method: method,
            product_ids: lines.map((p) => p.id).join(","),
            top_product: lines[0].name,
            client_country: ctx.country,
            user_id: ctx.userId,
            duration_ms: Math.round(s.durationUs / 1000),
          }),
        );
      }
      return cursor;
    },
  };

  const simulateRequest = (
    routeId: SampleRouteId,
    at: number,
    ctx: { userId: string; country: string; logs: Row[] },
  ): RequestResult => {
    const route = SAMPLE_ROUTES.find((r) => r.id === routeId)!;
    if (routeId === "staticAsset") {
      return {
        traceId: "",
        status: Math.random() < 0.01 ? 404 : 200,
        durationUs: Math.round(latencyMs(3, 0.5) * 1000),
        spans: [],
        logs: [],
      };
    }
    const tb = new TraceBuilder();
    const entry: SampleServiceName = routeId === "home" ? "frontend" : "api-gateway";
    const root = serverSpan(tb, entry, route.method, route.route, at);
    root.attrs["http.user_agent.family"] = "browser";
    root.attrs["enduser.id"] = ctx.userId;
    const end = flows[routeId](tb, root, at, ctx);
    close(root, end, 0.8);
    const status = Number(root.attrs["http.status_code"] ?? 200);
    root.attrs["http.status_code"] = status;
    if (status >= 500 && !root.error)
      root.error = { type: "HTTPError", message: `upstream returned ${status}` };
    ctx.logs.push(
      spanLog(
        root,
        tb.traceId,
        status >= 500 ? "error" : status >= 400 ? "warn" : "info",
        `${route.method} ${route.route} ${status} ${Math.round(root.durationUs / 1000)}ms`,
        {
          http_method: route.method,
          http_route: route.route,
          http_status_code: status,
          duration_ms: Math.round(root.durationUs / 1000),
          user_id: ctx.userId,
          client_country: ctx.country,
        },
      ),
    );
    return {
      traceId: tb.traceId,
      status,
      durationUs: root.durationUs,
      spans: tb.spans,
      logs: ctx.logs,
    };
  };

  const toOtlp = (traceId: string, s: SpanDraft): OtlpSpan => {
    const code = s.error ? STATUS.error : s.kind === KIND.server ? STATUS.ok : STATUS.unset;
    const span: OtlpSpan = {
      traceId,
      spanId: s.spanId,
      name: s.name,
      kind: s.kind,
      startTimeUnixNano: `${s.startUs}000`,
      endTimeUnixNano: `${endOf(s)}000`,
      attributes: Object.entries(s.attrs).map(([k, v]) => attr(k, v)),
      status: s.error ? { code, message: s.error.message } : { code },
    };
    if (s.parentSpanId) span.parentSpanId = s.parentSpanId;
    if (s.error) {
      span.events = [
        {
          timeUnixNano: `${endOf(s)}000`,
          name: "exception",
          attributes: [
            attr("exception.type", s.error.type),
            attr("exception.message", s.error.message),
          ],
        },
      ];
    }
    return span;
  };

  const groupResourceSpans = (byKey: Map<string, OtlpSpan[]>): OtlpResourceSpans[] =>
    [...byKey.entries()].map(([key, spans]) => {
      const [service, pod, version] = key.split("|") as [SampleServiceName, string, string];
      const svc = serviceByName(service);
      return {
        resource: {
          attributes: [
            attr("service.name", service),
            attr("service.version", version),
            attr("service.namespace", SAMPLE_NAMESPACE),
            attr("deployment.environment", "production"),
            attr("telemetry.sdk.language", svc.language),
            attr("k8s.namespace.name", SAMPLE_NAMESPACE),
            attr("k8s.pod.name", pod),
            attr("k8s.node.name", nodeForPod(pod)),
            attr("team", svc.team),
          ],
        },
        scopeSpans: [{ scope: { name: "openobserve-sample-data", version: "1.0.0" }, spans }],
      };
    });

  const bump = (key: string, by: number) => {
    const next = (counters.get(key) ?? 0) + by;
    counters.set(key, next);
    return next;
  };

  const emitSlot = (slotUs: number, stats: SlotStats, out: Row[]) => {
    const ts = slotUs + SCRAPE_US - 1;
    for (const svc of SAMPLE_SERVICES) {
      for (const pod of svc.pods) {
        for (const statusClass of ["2xx", "4xx", "5xx"]) {
          const key = `${svc.name}|${pod}|${statusClass}`;
          const value = bump(`req|${key}`, stats.requests.get(key) ?? 0);
          out.push({
            __name__: SAMPLE_METRICS.requests,
            __type__: "counter",
            _timestamp: ts,
            value,
            service: svc.name,
            pod,
            namespace: SAMPLE_NAMESPACE,
            status_class: statusClass,
          });
        }
        const handled = ["2xx", "4xx", "5xx"].reduce(
          (sum, c) => sum + (stats.requests.get(`${svc.name}|${pod}|${c}`) ?? 0),
          0,
        );
        const hot = svc.name === "payment" && inPaymentIncident(slotUs) ? 38 : 0;
        const cpu = Math.min(98, 6 + handled * 0.7 + hot + Math.abs(gaussian()) * 4);
        out.push({
          __name__: SAMPLE_METRICS.cpu,
          __type__: "gauge",
          _timestamp: ts,
          value: Math.round(cpu * 10) / 10,
          service: svc.name,
          pod,
          node: nodeForPod(pod),
          namespace: SAMPLE_NAMESPACE,
        });
        const progress = (slotUs - startUs) / Math.max(1, endUs - startUs);
        const leak = svc.name === "recommendation" ? progress * 520 : 0;
        const sawtooth = ((slotUs / MINUTE_US) % 17) * 3;
        const memMiB = svc.memoryMiB + leak + sawtooth + gaussian() * 6;
        out.push({
          __name__: SAMPLE_METRICS.memory,
          __type__: "gauge",
          _timestamp: ts,
          value: Math.round(memMiB * 1024 * 1024),
          service: svc.name,
          pod,
          node: nodeForPod(pod),
          namespace: SAMPLE_NAMESPACE,
        });
      }
      const lat = (stats.latencies.get(svc.name) ?? []).sort((a, b) => a - b);
      if (lat.length) {
        const p95 = lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))];
        out.push({
          __name__: SAMPLE_METRICS.latencyP95,
          __type__: "gauge",
          _timestamp: ts,
          value: Math.round(p95 * 10) / 10,
          service: svc.name,
          namespace: SAMPLE_NAMESPACE,
        });
      }
    }
    for (const pm of PAYMENT_METHODS) {
      for (const status of ["completed", "failed"]) {
        const key = `${pm.method}|${status}`;
        const value = bump(`orders|${key}`, stats.orders.get(key) ?? 0);
        out.push({
          __name__: SAMPLE_METRICS.orders,
          __type__: "counter",
          _timestamp: ts,
          value,
          payment_method: pm.method,
          status,
        });
      }
    }
    const paymentLag = inPaymentIncident(slotUs)
      ? 400 + ((slotUs - incident.paymentFromUs) / MINUTE_US) * 95
      : 12;
    out.push({
      __name__: SAMPLE_METRICS.kafkaLag,
      __type__: "gauge",
      _timestamp: ts,
      value: Math.round(paymentLag + Math.abs(gaussian()) * 8),
      topic: "payment-events",
      consumer_group: "ledger",
    });
    out.push({
      __name__: SAMPLE_METRICS.kafkaLag,
      __type__: "gauge",
      _timestamp: ts,
      value: Math.round(18 + Math.abs(gaussian()) * 10),
      topic: "orders",
      consumer_group: "shipping",
    });
  };

  const recordStats = (stats: SlotStats, result: RequestResult) => {
    for (const s of result.spans) {
      if (s.kind !== KIND.server) continue;
      const code = Number(s.attrs["http.status_code"] ?? 200);
      const statusClass = code >= 500 ? "5xx" : code >= 400 ? "4xx" : "2xx";
      const key = `${s.service}|${s.pod}|${statusClass}`;
      stats.requests.set(key, (stats.requests.get(key) ?? 0) + 1);
      const list = stats.latencies.get(s.service) ?? [];
      list.push(s.durationUs / 1000);
      stats.latencies.set(s.service, list);
    }
  };

  const backgroundLogs = (minuteUs: number, out: Row[]) => {
    const minute = Math.round(minuteUs / MINUTE_US);
    if (minute % 5 === 0) {
      const inv = serviceByName("inventory");
      out.push({
        ...baseLog(
          "inventory",
          inv.pods[0],
          minuteUs + 2_000_000,
          "info",
          `Inventory sync completed: ${1280 + (minute % 9)} SKUs reconciled in ${(2 + Math.random()).toFixed(1)}s`,
        ),
        job: "inventory-sync",
      });
    }
    if (minute % 10 === 0) {
      const c = serviceByName("cart");
      out.push({
        ...baseLog(
          "cart",
          c.pods[1],
          minuteUs + 5_000_000,
          "info",
          `Evicted ${200 + Math.floor(Math.random() * 180)} expired carts`,
        ),
        job: "cart-janitor",
      });
    }
    if (inPaymentIncident(minuteUs)) {
      const p = serviceByName("payment");
      for (const pod of p.pods) {
        out.push({
          ...baseLog(
            "payment",
            pod,
            minuteUs + 9_000_000,
            "warn",
            "Connection pool saturated: 20/20 connections in use, 37 waiting",
          ),
          db_pool_in_use: 20,
          db_pool_max: 20,
          db_pool_waiting: 37,
        });
      }
    }
    if (inRecoIncident(minuteUs)) {
      const r = serviceByName("recommendation");
      out.push({
        ...baseLog(
          "recommendation",
          r.pods[0],
          minuteUs + 4_000_000,
          "warn",
          "GC pause 840ms exceeded threshold (500ms)",
        ),
        gc_pause_ms: 840,
      });
    }
    if (minute % 3 === 0) {
      const gw = serviceByName("api-gateway");
      out.push({
        ...baseLog(
          "api-gateway",
          pick(gw.pods),
          minuteUs + 1_000_000,
          "debug",
          "Upstream health check passed for 9 services",
        ),
      });
    }
  };

  const deployLogs = (fromUs: number, toUs: number, out: Row[]) => {
    const deployAt = incident.paymentFromUs - 60_000_000;
    if (deployAt >= fromUs && deployAt < toUs) {
      const p = serviceByName("payment");
      out.push({
        ...baseLog(
          "payment",
          p.pods[0],
          deployAt,
          "info",
          "Starting payment service v2.15.0 (release notes: switch ledger writes to synchronous mode, reduce pool max to 20)",
        ),
        event: "deployment",
        previous_version: "2.14.0",
      });
      out.push({
        ...baseLog(
          "payment",
          p.pods[1],
          deployAt + 20_000_000,
          "info",
          "Rolled out payment v2.15.0 to 2/2 pods",
        ),
        event: "deployment",
        previous_version: "2.14.0",
      });
    }
  };

  const diurnal = (ts: number) => {
    const hour = new Date(ts / 1000).getUTCHours() + new Date(ts / 1000).getUTCMinutes() / 60;
    return 0.8 + 0.35 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
  };

  const generateChunk = (index: number): SampleBatch => {
    const fromUs = startUs + index * CHUNK_US;
    const toUs = Math.min(endUs, fromUs + CHUNK_US);
    const appLogs: Row[] = [];
    const accessLogs: Row[] = [];
    const metrics: Row[] = [];
    const spansByResource = new Map<string, OtlpSpan[]>();
    let spanCount = 0;
    deployLogs(fromUs, toUs, appLogs);

    for (let slotUs = fromUs; slotUs < toUs; slotUs += SCRAPE_US) {
      const stats: SlotStats = { requests: new Map(), latencies: new Map(), orders: new Map() };
      if ((slotUs - fromUs) % MINUTE_US === 0) backgroundLogs(slotUs, appLogs);
      const slotEnd = Math.min(toUs, slotUs + SCRAPE_US);
      for (let secUs = slotUs; secUs < slotEnd; secUs += 1_000_000) {
        const n = poisson(BASE_RPS * diurnal(secUs));
        for (let i = 0; i < n; i++) {
          const at = secUs + Math.floor(Math.random() * 1_000_000);
          const userSeed = Math.floor(Math.random() * userCount);
          const userId = `u_${(100000 + userSeed).toString(36)}`;
          const country = pickWeighted(COUNTRIES).code;
          const ua = pickWeighted(USER_AGENTS).ua;
          const route = pickWeighted(SAMPLE_ROUTES);
          const logs: Row[] = [];
          const result = simulateRequest(route.id, at, { userId, country, logs });
          const keep =
            result.spans.length > 0 &&
            (result.status >= 500 || result.durationUs > 1_000_000 || Math.random() < 0.3);
          // a log may only link to a trace that was actually kept by sampling
          if (!keep) {
            for (const l of result.logs) {
              delete l.trace_id;
              delete l.span_id;
            }
          }
          appLogs.push(...result.logs);
          recordStats(stats, result);
          if (route.id === "checkout") {
            const placed = result.status < 400;
            const method = String(
              result.logs.find((l) => l.payment_method)?.payment_method ?? "card",
            );
            const key = `${method}|${placed ? "completed" : "failed"}`;
            stats.orders.set(key, (stats.orders.get(key) ?? 0) + 1);
          }
          const path =
            route.id === "staticAsset"
              ? `/static/${pick(STATIC_ASSETS)}`
              : route.id === "getProduct"
                ? `/api/products/${String(result.spans[0]?.attrs["product.id"] ?? pick(PRODUCTS).id)}`
                : route.route;
          const accessLog: Row = {
            _timestamp: at,
            remote_addr: ipFor(userSeed),
            method: route.method,
            path,
            route: route.route,
            protocol: "HTTP/2.0",
            status: result.status,
            body_bytes_sent:
              route.id === "staticAsset"
                ? 4000 + Math.floor(Math.random() * 180000)
                : 300 + Math.floor(Math.random() * 9000),
            request_time: Math.round(result.durationUs / 1000) / 1000,
            upstream:
              route.id === "staticAsset"
                ? "cdn-origin"
                : route.id === "home"
                  ? "frontend"
                  : "api-gateway",
            http_user_agent: ua,
            http_referer:
              route.id === "home" ? "https://www.google.com/" : "https://shop.example.com/",
            client_country: country,
            host: "shop.example.com",
            user_id: userId,
          };
          if (keep) accessLog.trace_id = result.traceId;
          accessLogs.push(accessLog);
          if (keep) {
            for (const s of result.spans) {
              const key = `${s.service}|${s.pod}|${versionOf(s.service, s.startUs)}`;
              const list = spansByResource.get(key) ?? [];
              list.push(toOtlp(result.traceId, s));
              spansByResource.set(key, list);
              spanCount++;
            }
          }
        }
      }
      emitSlot(slotUs, stats, metrics);
    }
    return {
      appLogs,
      accessLogs,
      traces: { resourceSpans: groupResourceSpans(spansByResource) },
      spanCount,
      metrics,
    };
  };

  return { chunkCount, generateChunk, incident };
}
