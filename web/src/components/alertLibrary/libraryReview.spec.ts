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

import { describe, expect, it } from "vitest";

import {
  labelMatchers,
  mapBounded,
  needsDataText,
  reviewDestination,
  reviewThreshold,
  userEmailDestination,
} from "./libraryReview";

describe("labelMatchers", () => {
  it("reads an equality matcher off a metric selector", () => {
    expect(labelMatchers('up{job="hadoop-namenode"} == 0')).toEqual([
      { metric: "up", label: "job", value: "hadoop-namenode" },
    ]);
  });

  it("reads every selector and every equality matcher in the expression", () => {
    const expr =
      'sum by (instance) (rate(http_requests_total{job="api", code="500"}[5m])) / ' +
      'sum by (instance) (rate(http_requests_total{job="api"}[5m]))';
    expect(labelMatchers(expr)).toEqual([
      { metric: "http_requests_total", label: "job", value: "api" },
      { metric: "http_requests_total", label: "code", value: "500" },
    ]);
  });

  it("skips negative, regex and empty-value matchers", () => {
    expect(labelMatchers('up{job!="a", env=~"prod.*", zone!~"x", team=""}')).toEqual([]);
  });

  it("takes the metric from __name__ when the selector has no name in front", () => {
    expect(labelMatchers('{__name__="node_load1", instance="host-1"}')).toEqual([
      { metric: "node_load1", label: "instance", value: "host-1" },
    ]);
  });

  it("skips a selector with no metric to scope the check to", () => {
    expect(labelMatchers('{job="api"}')).toEqual([]);
  });

  it("keeps an escaped quote and a comma inside a value", () => {
    expect(labelMatchers('up{path="a\\"b,c", job=\'x\'}')).toEqual([
      { metric: "up", label: "path", value: 'a"b,c' },
      { metric: "up", label: "job", value: "x" },
    ]);
  });

  it("answers an empty list for a non-string", () => {
    expect(labelMatchers(undefined as unknown as string)).toEqual([]);
  });
});

describe("mapBounded", () => {
  it("never runs more than the limit at once and keeps the input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapBounded([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, (10 - item) * 2));
      inFlight -= 1;
      return item * 10;
    });
    expect(peak).toBe(4);
    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
  });

  it("keeps going after one item fails", async () => {
    const seen: number[] = [];
    const results = await mapBounded([1, 2, 3], 2, async (item) => {
      seen.push(item);
      if (item === 1) throw new Error("boom");
      return item;
    });
    expect(seen.sort()).toEqual([1, 2, 3]);
    expect(results).toEqual([undefined, 2, 3]);
  });
});

describe("needsDataText", () => {
  it("names each missing label and value", () => {
    expect(
      needsDataText([
        { metric: "up", label: "job", value: "hadoop-namenode" },
        { metric: "up", label: "env", value: "prod" },
      ]),
    ).toBe("job hadoop-namenode, env prod");
  });
});

describe("reviewDestination", () => {
  const routes = { orgDefault: "pagerduty", email: "email-me@example.com" };

  it("sends a critical rule to the org default destination", () => {
    expect(reviewDestination("critical", routes)).toBe("pagerduty");
  });

  it("sends a warning to the user's email destination", () => {
    expect(reviewDestination("warning", routes)).toBe("email-me@example.com");
    expect(reviewDestination("info", routes)).toBe("email-me@example.com");
  });

  it("sends a warning nowhere when the user has no email destination", () => {
    expect(reviewDestination("warning", { orgDefault: "pagerduty", email: "" })).toBe("");
  });
});

describe("userEmailDestination", () => {
  const list = [
    { name: "team", type: "email", emails: ["me@example.com", "you@example.com"] },
    { name: "hook", type: "http", emails: [] },
    { name: "mine", type: "email", emails: [" Me@Example.com "] },
  ];

  it("finds the email destination that sends only to the user", () => {
    expect(userEmailDestination(list, "me@example.com")).toBe("mine");
  });

  it("answers empty when there is none or no address", () => {
    expect(userEmailDestination(list, "other@example.com")).toBe("");
    expect(userEmailDestination(list, "")).toBe("");
  });
});

describe("reviewThreshold", () => {
  it("states a PromQL rule's condition", () => {
    expect(
      reviewThreshold({
        query_condition: {
          type: "promql",
          promql: "up",
          promql_condition: { operator: "<", value: 1 },
        },
      }),
    ).toBe("< 1");
  });

  it("states a SQL rule's row count", () => {
    expect(
      reviewThreshold({ trigger_condition: { operator: ">", threshold: 5 }, query_condition: {} }),
    ).toBe("> 5");
  });
});
