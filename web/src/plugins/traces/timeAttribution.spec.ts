// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import en from "@/locales/languages/en-US.json";
import type { TranslateFn } from "@/types/i18n";
import {
  attributeSteps,
  attributionSentence,
  criticalPathServices,
  firstRestartUs,
  headlineSteps,
  mergedHeadlines,
  subtreeOf,
} from "./timeAttribution";

const S = 1_000_000_000; // ns per second
const US = 1_000_000; // µs per second

const span = (
  id: string,
  parent: string,
  startS: number,
  endS: number | undefined,
  extra: Record<string, unknown> = {},
) => ({
  span_id: id,
  reference_parent_span_id: parent,
  start_time: 1000 * S + startS * S,
  end_time: endS === undefined ? undefined : 1000 * S + endS * S,
  operation_name: id,
  service_name: "support-bot",
  span_status: "UNSET",
  ...extra,
});

const tool = (name: string) => ({ gen_ai_operation_name: "execute_tool", gen_ai_tool_name: name });
const chat = { gen_ai_operation_name: "chat" };
const http = { service_name: "orders-api", http_request_method: "GET" };
const db = { service_name: "orders-api", db_system: "postgresql", server_address: "orders-db" };

// en-US lookup with {name} interpolation, enough to read the sentences back.
const t = ((key: string, named: Record<string, unknown> = {}) => {
  const template = key.split(".").reduce<any>((node, part) => node?.[part], en) as string;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(named[k]));
}) as TranslateFn;

// The design's support-bot answer: a 12 s request whose tool call waited on one Postgres query.
const supportBot = [
  span("root", "", 0, 12, { gen_ai_operation_name: "invoke_agent" }),
  span("chat-1", "root", 0.1, 1.3, chat),
  span("lookup", "root", 1.5, 10.5, tool("lookup_order")),
  span("GET /orders/{id}", "lookup", 1.6, 10.4, http),
  span("SELECT orders", "GET /orders/{id}", 1.7, 10.3, db),
  span("chat-2", "root", 10.6, 12, chat),
];

describe("attributeSteps", () => {
  it("names the database query behind a tool → HTTP → DB chain", () => {
    const [step] = headlineSteps(attributeSteps(supportBot));
    expect(step).toMatchObject({ spanId: "lookup", kind: "tool", slow: true, durationUs: 9 * US });
    expect(step.cause).toMatchObject({
      spanId: "SELECT orders",
      kind: "db",
      system: "postgresql",
      target: "orders-db",
      timeUs: 8_600_000,
    });
    expect(attributionSentence(step, t)).toBe(
      "lookup_order took 9.00s. 8.60s of it was one postgresql query, SELECT orders on orders-db.",
    );
  });

  it("sums an N+1 loop of identical queries into one cause", () => {
    const statement = "SELECT order_items WHERE order_id = $1";
    const [step] = attributeSteps([
      span("root", "", 0, 10, { gen_ai_operation_name: "invoke_agent" }),
      span("fetch", "root", 0.5, 9.5, tool("fetch_orders")),
      span("GET /orders", "fetch", 0.525, 9.475, http),
      ...Array.from({ length: 30 }, (_, i) =>
        span(`select-${i}`, "GET /orders", 0.6 + i * 0.29, 0.6 + (i + 1) * 0.29, {
          ...db,
          operation_name: statement,
        }),
      ),
    ]);
    expect(step.cause).toMatchObject({ kind: "db", name: statement, count: 30 });
    expect(step.cause!.timeUs).toBeCloseTo(8.7 * US, -3);
    expect(attributionSentence(step, t)).toBe(
      `fetch_orders took 9.00s. 8.70s of it was 30 postgresql queries, ${statement} on orders-db.`,
    );
  });

  it("does not group same-named calls to different targets", () => {
    const get = (server: string) => ({ ...http, operation_name: "GET", server_address: server });
    const [step] = attributeSteps([
      span("checkout", "", 0, 9, tool("checkout")),
      span("auth", "checkout", 0.1, 1.1, get("auth-svc")),
      span("inventory", "checkout", 1.2, 4.2, get("inventory-svc")),
      span("pricing", "checkout", 4.3, 8.8, get("pricing-svc")),
    ]);
    expect(step.cause).toMatchObject({ spanId: "pricing", target: "pricing-svc", count: 1 });
    expect(attributionSentence(step, t)).toBe(
      "checkout took 9.00s. 4.50s of it was GET on pricing-svc.",
    );
  });

  it("names the slowest branch of a parallel fan-out on its own", () => {
    const [step] = attributeSteps([
      span("fanout", "", 0, 8, tool("fan_out")),
      span("GET /svc-a", "fanout", 0.1, 2, { ...http, service_name: "svc-a" }),
      span("GET /svc-b", "fanout", 0.1, 4, { ...http, service_name: "svc-b" }),
      span("GET /svc-c", "fanout", 0.2, 7.7, { ...http, service_name: "svc-c" }),
    ]);
    expect(step.cause).toMatchObject({ spanId: "GET /svc-c", count: 1 });
    expect(attributionSentence(step, t)).toBe(
      "fan_out took 8.00s. 7.50s of it was GET /svc-c on svc-c.",
    );
  });

  it("only flags steps of at least 1 s and half the trace as slow", () => {
    const steps = attributeSteps(supportBot);
    expect(steps.map((s) => [s.spanId, s.slow])).toEqual([
      ["chat-1", false],
      ["lookup", true],
      ["chat-2", false],
    ]);
  });

  it("keeps an LLM turn with no children as its own cause", () => {
    const steps = attributeSteps([
      span("root", "", 0, 3, { gen_ai_operation_name: "invoke_agent" }),
      span("chat gpt-4o", "root", 0.2, 2.7, chat),
      span("search", "root", 2.75, 2.9, tool("search")),
    ]);
    const [step] = headlineSteps(steps);
    expect(step).toMatchObject({ spanId: "chat gpt-4o", kind: "llm", cause: null });
    expect(attributionSentence(step, t)).toBe(
      "chat gpt-4o took 2.50s. All of it was the model call.",
    );
  });

  it("does not call out a trace that is one healthy model call", () => {
    const steps = attributeSteps([
      span("root", "", 0, 3, { gen_ai_operation_name: "invoke_agent" }),
      span("chat gpt-4o", "root", 0.2, 2.7, chat),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ slow: false, headline: false });
    expect(headlineSteps(steps)).toEqual([]);
  });

  it("still calls out that one model call when it failed", () => {
    const steps = attributeSteps([
      span("chat gpt-4o", "", 0, 1.5, { ...chat, span_status: "ERROR" }),
    ]);
    expect(headlineSteps(steps).map((s) => s.spanId)).toEqual(["chat gpt-4o"]);
  });

  it("names the innermost slow step and the deepest span when durations nest equally", () => {
    const steps = attributeSteps([
      span("chat", "", 0, 9, chat),
      span("lookup", "chat", 0, 9, tool("lookup_order")),
      span("GET", "lookup", 0, 9, http),
      span("SELECT", "GET", 0, 9, db),
    ]);
    expect(steps.map((s) => [s.spanId, s.slow, s.headline, s.cause?.spanId])).toEqual([
      ["chat", true, false, "SELECT"],
      ["lookup", true, true, "SELECT"],
    ]);
  });

  it("falls back to the duration, then to zero length, when an end time is missing", () => {
    const steps = attributeSteps([
      span("root", "", 0, 10),
      { ...span("lookup", "root", 0.5, undefined, tool("lookup_order")), duration: 9 * US },
      span("SELECT", "lookup", 0.6, 9.4, db),
      span("no-end", "lookup", 9.45, undefined, http),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ durationUs: 9 * US, slow: true });
    expect(steps[0].cause).toMatchObject({ spanId: "SELECT", timeUs: 8_800_000 });
  });

  it("says a failed step failed", () => {
    const [step] = attributeSteps([
      span("root", "", 0, 2),
      span("fetch", "root", 0, 0.4, { ...tool("web_fetch"), span_status: "ERROR" }),
    ]);
    expect(step.failed).toBe(true);
    expect(attributionSentence(step, t)).toBe(
      "web_fetch failed after 400.00ms. The step itself held the time, not a child span.",
    );
  });
});

describe("criticalPathServices", () => {
  it("orders services by critical-path time, each with its busiest span", () => {
    const services = criticalPathServices(supportBot);
    expect(services.map((s) => [s.service, s.span.span_id])).toEqual([
      ["orders-api", "SELECT orders"],
      ["support-bot", "chat-2"],
    ]);
  });
});

describe("subtreeOf", () => {
  it("returns the span and everything under it", () => {
    expect(subtreeOf(supportBot, "lookup").map((s) => s.span_id)).toEqual([
      "lookup",
      "GET /orders/{id}",
      "SELECT orders",
    ]);
  });
});

describe("mergedHeadlines", () => {
  it("says identical parallel steps once, keyed by a span id", () => {
    const steps = headlineSteps(
      attributeSteps([
        span("root", "", 0, 9.2, { gen_ai_operation_name: "invoke_agent" }),
        span("a", "root", 0.1, 9.1, { ...tool("search"), operation_name: "search" }),
        span("b", "root", 0.1, 9.1, { ...tool("search"), operation_name: "search" }),
      ]),
    );
    expect(steps).toHaveLength(2);
    const headlines = mergedHeadlines(steps, t);
    expect(headlines).toHaveLength(1);
    expect(["a", "b"]).toContain(headlines[0].key);
    expect(headlines[0].text).toBe(
      "2 identical steps, each: search took 9.00s. The step itself held the time, not a child span.",
    );
  });

  it("keeps different sentences apart", () => {
    const headlines = mergedHeadlines(headlineSteps(attributeSteps(supportBot)), t);
    expect(headlines.map((h) => h.key)).toEqual(["lookup"]);
  });
});

describe("firstRestartUs", () => {
  const series = [
    {
      values: [
        [100, "2"],
        [115, "2"],
        [130, "3"],
      ] as [number, string][],
    },
  ];

  it("dates the rise to the sample before it, the earliest the restart can have been", () => {
    expect(firstRestartUs(series, 100 * US, 200 * US)).toBe(115 * US);
  });

  it("ignores a rise outside the window", () => {
    expect(firstRestartUs(series, 100 * US, 120 * US)).toBeNull();
  });

  it("places a restart inside the trace when the 15 s grid puts the rise after it", () => {
    // The OOMKilled trace: spans 1793230296.5–1793230329.95, samples at :320 and :335.
    const atUs = firstRestartUs(
      [
        {
          values: [
            [1793230320, "2"],
            [1793230335, "3"],
          ],
        },
      ],
      1793230296.5 * US,
      1793230329.95 * US + 60 * US,
    );
    expect(atUs).toBe(1793230320 * US);
  });

  it("never dates a restart before the window", () => {
    expect(firstRestartUs(series, 120 * US, 200 * US)).toBe(120 * US);
  });
});
