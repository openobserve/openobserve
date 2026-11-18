// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import i18n from "@/locales";
import { noSeriesReason, noSeriesSentence, selectorsOf } from "./promqlNoSeries";

const t = i18n.global.t as any;
const sel = (name: string, matchers: { label: string; op: string; value: string }[] = []) => ({
  type: "selector",
  name,
  matchers,
});
const fiveXx = { label: "http_status_code", op: "=~", value: "5.." };
const SERIES = {
  http_server_duration_count: [
    { __name__: "http_server_duration_count", service_name: "cart", http_status_code: "200" },
    { __name__: "http_server_duration_count", service_name: "checkout", http_status_code: "200" },
    { __name__: "http_server_duration_count", service_name: "cart", http_status_code: "404" },
    {
      __name__: "http_server_duration_count",
      service_name: "ad",
      http_response_status_code: "500",
    },
  ],
};

describe("selectorsOf", () => {
  it("lists each selector of a ratio once, matrix selectors included", () => {
    const tree = {
      type: "binary",
      op: "/",
      lhs: {
        type: "call",
        func: "rate",
        args: [{ type: "matrix", range: "5m", selector: sel("a", [fiveXx]) }],
      },
      rhs: {
        type: "aggregate",
        op: "sum",
        expr: { type: "call", func: "rate", args: [{ type: "matrix", selector: sel("a") }] },
      },
    };
    expect(selectorsOf(tree)).toEqual([
      { name: "a", matchers: [fiveXx] },
      { name: "a", matchers: [] },
    ]);
  });
});

describe("noSeriesReason", () => {
  const of = (metric: string) => (SERIES as Record<string, Record<string, string>[]>)[metric] ?? [];
  it.each([
    {
      name: "a metric without series",
      selectors: [{ name: "gone", matchers: [] }],
      expected: { kind: "noData", metric: "gone" },
    },
    {
      name: "a filter on a label the metric lacks",
      selectors: [
        {
          name: "http_server_duration_count",
          matchers: [{ label: "status", op: "=", value: "500" }],
        },
      ],
      expected: {
        kind: "labelMissing",
        metric: "http_server_duration_count",
        label: "status",
        labels: ["http_response_status_code", "http_status_code", "service_name"],
      },
    },
    {
      name: "a filter value no series carries, values ranked by series",
      selectors: [
        { name: "http_server_duration_count", matchers: [fiveXx] },
        { name: "http_server_duration_count", matchers: [] },
      ],
      expected: {
        kind: "valueNotSeen",
        matcher: 'http_status_code=~"5.."',
        label: "http_status_code",
        seen: [
          ["200", 2],
          ["404", 1],
          [null, 1],
        ],
      },
    },
    {
      name: "selectors that all match: the expression emptied it",
      selectors: [
        {
          name: "http_server_duration_count",
          matchers: [{ label: "http_status_code", op: "!~", value: "5.." }],
        },
      ],
      expected: { kind: "expression", metric: "http_server_duration_count", series: 4 },
    },
  ])("$name", ({ selectors, expected }) => {
    expect(noSeriesReason(selectors as any, of)).toEqual(expected);
  });

  it("says which part of a ratio matched nothing, in words", () => {
    const reason = noSeriesReason(
      [{ name: "http_server_duration_count", matchers: [fiveXx] }] as any,
      of,
    );
    expect(noSeriesSentence(reason!, t)).toBe(
      'http_status_code=~"5.." hasn\'t appeared in the last 24 hours. Seen: 200 (2), 404 (1), and without http_status_code (1).',
    );
  });
});
